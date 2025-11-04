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
  console.log(`[FlushPostViews] 🧭 Iniciando SCAN no Redis...`)

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
      console.log(
        `[FlushPostViews] Encontradas ${batch.length} chaves (total até agora: ${keys.length})`,
      )
    }
  } while (cursor !== "0")

  console.log(
    `[FlushPostViews] SCAN concluído. Total de chaves: ${keys.length}`,
  )
  return keys
}

async function applyChunk(
  chunk: Array<{ key: string; postId: string; val: number }>,
) {
  console.log(
    `[FlushPostViews] 🧩 Aplicando chunk de ${chunk.length} posts no banco...`,
  )

  const start = performance.now()
  await prisma.$transaction(
    chunk.map((item) =>
      prisma.post.update({
        where: { id: item.postId },
        data: { views: { increment: item.val } },
        select: { id: true },
      }),
    ),
  )

  const duration = performance.now() - start
  console.log(
    `[FlushPostViews] ✅ ${chunk.length} posts atualizados no banco (${duration.toFixed(1)}ms)`,
  )

  const pipeline = redis.pipeline()
  chunk.forEach((item) => pipeline.del(item.key))
  await pipeline.exec()

  console.log(`[FlushPostViews] 🧹 Chaves removidas do Redis.`)
}

export interface FlushPostViewsData {
  // vazio: é um job “cron”
}

export default {
  key: "FlushPostViews",

  // rode a cada 10 min. Ajuste se precisar.
  options: {
    repeat: { cron: "*/1 * * * *" }, // a cada 10 minutos
    removeOnComplete: true,
    removeOnFail: 50,
    limiter: { max: 1, duration: 60000 }, // só 1 execução por minuto
  },

  async handle(_job: Job<FlushPostViewsData>) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    console.log(
      `[FlushPostViews] 🚀 Job iniciado às ${new Date().toISOString()}`,
    )

    const t0 = performance.now()

    try {
      const keys = await scanPendingKeys()
      if (keys.length === 0) {
        console.log("[FlushPostViews] ⚪ Nenhuma pendência encontrada.")
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        return
      }

      console.log(
        `[FlushPostViews] 🔢 Lendo valores das ${keys.length} chaves...`,
      )
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
        console.log(
          "[FlushPostViews] ⚪ Nenhuma chave com valor válido encontrada.",
        )
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
        return
      }

      console.log(
        `[FlushPostViews] 🧮 Serão aplicadas ${toApply.length} atualizações (views).`,
      )

      const CHUNK_SIZE = 100
      for (let i = 0; i < toApply.length; i += CHUNK_SIZE) {
        const chunk = toApply.slice(i, i + CHUNK_SIZE)
        console.log(
          `[FlushPostViews] 🔄 Processando chunk ${i / CHUNK_SIZE + 1}/${Math.ceil(
            toApply.length / CHUNK_SIZE,
          )}`,
        )
        await applyChunk(chunk)
      }

      const elapsed = (performance.now() - t0).toFixed(0)
      console.log(`[FlushPostViews] 🎯 Job concluído em ${elapsed}ms`)
    } catch (err) {
      console.error("[FlushPostViews] ❌ Erro durante execução:", err)
    } finally {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    }
  },
}
