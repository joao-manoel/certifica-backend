import type { Job } from "bull"
import { prisma } from "@/lib/prisma"
import { redis } from "@/lib/redis"

/**
 * Chaves usadas no track:
 * - pv:pending:<postId>  (contador a aplicar no banco)
 * - pv:u:<postId>:<yyyymmdd> (SET de fingerprints diários, TTL curto)
 * - pv:hits:<postId>:<yyyymmdd> (opcional: hits crus p/ debug)
 */

async function scanPendingKeys(pattern = "pv:pending:*", count = 200) {
  let cursor = "0"
  const keys: string[] = []

  do {
    const [nextCursor, batch] = (await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      count,
    )) as [string, string[]]
    cursor = nextCursor
    if (batch && batch.length) {
      keys.push(...batch)
    }
  } while (cursor !== "0")

  return keys
}

async function applyChunk(
  chunk: Array<{ key: string; postId: string; val: number }>,
) {
  // 0) saneamento: ignora val <= 0 e chaves malformadas
  const clean = chunk.filter(
    (it) => it.val > 0 && it.postId && typeof it.postId === "string",
  )

  // 1) busca quais posts existem
  const ids = [...new Set(clean.map((i) => i.postId))]
  const existing = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  })
  const existingSet = new Set(existing.map((p) => p.id))

  const valid = clean.filter((i) => existingSet.has(i.postId))
  const missing = clean.filter((i) => !existingSet.has(i.postId))

  // 2) trata os "órfãos" FORA da transação principal: limpa Redis e marca PostView
  if (missing.length) {
    // limpa as chaves órfãs
    const pipe = redis.pipeline()
    missing.forEach((m) => pipe.del(m.key))
    await pipe.exec()

    // opcional: marque PostView órfão como CANCELLED/ORPHANED (ou simplesmente delete)
    await prisma.postView.updateMany({
      where: {
        postId: { in: missing.map((m) => m.postId) },
        status: "PENDING",
      },
      data: { status: "DISCARDED", processedAt: new Date() },
    })
  }

  if (!valid.length) return

  // 3) transação: incrementa views e aplica PostView
  await prisma.$transaction(async (tx) => {
    // 3.1) incrementos individualizados, MAS só para IDs válidos
    for (const item of valid) {
      await tx.post.update({
        where: { id: item.postId },
        data: { views: { increment: item.val } },
        select: { id: true },
      })
    }

    // 3.2) sincroniza N PENDING -> APPLIED por post
    for (const item of valid) {
      const pendingRows = await tx.postView.findMany({
        where: { postId: item.postId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: item.val,
        select: { id: true },
      })

      if (pendingRows.length > 0) {
        await tx.postView.updateMany({
          where: { id: { in: pendingRows.map((r) => r.id) } },
          data: { status: "APPLIED", processedAt: new Date() },
        })
      }
    }
  })

  // 4) limpa as chaves pendentes (apenas as válidas)
  const pipe2 = redis.pipeline()
  valid.forEach((i) => pipe2.del(i.key))
  await pipe2.exec()
}

export interface FlushPostViewsData {
  // vazio: é um job “cron”
}

export default {
  key: "FlushPostViews",

  options: {
    repeat: { cron: "*/10 * * * *" }, // a cada 10 minutos (ajuste se quiser 1 min)
    removeOnComplete: true,
    removeOnFail: 50,
    limiter: { max: 1, duration: 60000 }, // só 1 execução por minuto
  },

  async handle(_job: Job<FlushPostViewsData>) {
    try {
      const keys = await scanPendingKeys()
      if (keys.length === 0) {
        return
      }

      const vals = await redis.mget(...keys)
      const toApply: Array<{ key: string; postId: string; val: number }> = []

      keys.forEach((key, i) => {
        const raw = vals[i]
        const n = raw ? Number(raw) : 0
        if (Number.isFinite(n) && n > 0) {
          const postId = key.split(":")[2] // pv:pending:<postId>
          if (postId) toApply.push({ key, postId, val: n })
        }
      })

      if (toApply.length === 0) {
        return
      }

      const CHUNK_SIZE = 100
      for (let i = 0; i < toApply.length; i += CHUNK_SIZE) {
        const chunk = toApply.slice(i, i + CHUNK_SIZE)
        await applyChunk(chunk)
      }
    } catch (err) {
      console.error("[FlushPostViews] ❌ Erro durante execução:", err)
    }
  },
}
