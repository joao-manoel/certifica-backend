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
    if (batch && batch.length) keys.push(...batch)
  } while (cursor !== "0")
  return keys
}

async function applyChunk(
  chunk: Array<{ key: string; postId: string; val: number }>,
) {
  // aplica no banco e apaga as chaves no Redis
  await prisma.$transaction(
    chunk.map((item) =>
      prisma.post.update({
        where: { id: item.postId },
        data: { views: { increment: item.val } },
        select: { id: true },
      }),
    ),
  )
  const pipeline = redis.pipeline()
  chunk.forEach((item) => pipeline.del(item.key))
  await pipeline.exec()
}

export interface FlushPostViewsData {
  // vazio: é um job “cron”
}

export default {
  key: "FlushPostViews",

  // rode a cada 10 min. Ajuste se precisar.
  options: {
    repeat: { cron: "*/10 * * * *" }, // a cada 10 minutos
    removeOnComplete: true,
    removeOnFail: 50,
    // opcional: limitar concorrência a 1 em process()
  },

  async handle(_job: Job<FlushPostViewsData>) {
    const keys = await scanPendingKeys()
    if (keys.length === 0) return

    // mget em lote
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

    if (toApply.length === 0) return

    // processa em chunks p/ evitar transações enormes
    const CHUNK_SIZE = 100
    for (let i = 0; i < toApply.length; i += CHUNK_SIZE) {
      const chunk = toApply.slice(i, i + CHUNK_SIZE)
      await applyChunk(chunk)
    }
  },
}
