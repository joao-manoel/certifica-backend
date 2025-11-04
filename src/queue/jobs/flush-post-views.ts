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
  // Transação única para:
  // 1) Incrementar Post.views
  // 2) Marcar N PostView como APPLIED (FIFO) por post
  await prisma.$transaction(async (tx) => {
    // 1) incrementos em lote
    await Promise.all(
      chunk.map((item) =>
        tx.post.update({
          where: { id: item.postId },
          data: { views: { increment: item.val } },
          select: { id: true },
        }),
      ),
    )

    // 2) sincroniza N linhas PENDING -> APPLIED por post
    for (const item of chunk) {
      if (item.val <= 0) continue

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
      // Obs: se houver menos PENDING que o 'val', aplicamos o que existe.
      // O resto fica "faltando" no Redis — mas como apagaremos a chave,
      // a diferença não será reaplicada. Em prática, esse cenário só ocorre
      // se houve expiração/limpeza de PostView antes do flush.
    }
  })

  // 3) limpa as chaves pendentes no Redis
  const pipeline = redis.pipeline()
  chunk.forEach((item) => pipeline.del(item.key))
  await pipeline.exec()
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
