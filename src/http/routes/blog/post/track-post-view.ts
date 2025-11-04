import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { redis } from "@/lib/redis"
import { PostStatus, Visibility } from "@prisma/client"

function isBot(ua: string | undefined) {
  const s = (ua ?? "").toLowerCase()
  if (!s) return false
  return (
    s.includes("bot") ||
    s.includes("spider") ||
    s.includes("crawler") ||
    s.includes("preview") ||
    s.includes("fetch") ||
    s.includes("monitoring") ||
    s.includes("headless") ||
    s.includes("pingdom")
  )
}

function yyyymmdd(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

export async function trackPostView(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/blog/posts/:slug/view",
    {
      schema: {
        tags: ["Posts"],
        summary: "Track a post view (dedup per day)",
        params: z.object({
          slug: z.string().min(1),
        }),
        body: z
          .object({
            // fingerprint opcional vindo do client; se ausente, caímos no fallback fraco (UA+IP+dia)
            fp: z.string().min(16).max(128).optional(),
          })
          .optional(),
        response: {
          204: z.null(),
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params
      const fpFromBody = request.body?.fp

      const ua = request.headers["user-agent"]
      if (isBot(ua)) {
        return reply.code(204).send() // ignora bots
      }

      console.log(`Tracking view for post "${slug}"`)

      // busca post
      const post = await prisma.post.findUnique({
        where: { slug },
        select: { id: true, status: true, visibility: true },
      })
      if (
        !post ||
        post.status !== PostStatus.PUBLISHED ||
        post.visibility !== Visibility.PUBLIC
      ) {
        return reply.code(204).send()
      }

      // fingerprint
      // prioridade: body.fp (hash de sessionId+UA+dia gerado no client)
      // fallback (fraco): ip truncado + UA + dia
      let fp = fpFromBody
      if (!fp) {
        const ip =
          (request.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() ||
          request.ip ||
          "0.0.0.0"
        const ipTrunc = ip.split(".").slice(0, 3).join(".") // privacidade básica
        fp = `${ipTrunc}:${(ua ?? "").slice(0, 80)}:${yyyymmdd()}`
      }

      const day = yyyymmdd()
      const setKey = `pv:u:${post.id}:${day}`
      const pendingKey = `pv:pending:${post.id}`
      const hitsKey = `pv:hits:${post.id}:${day}`

      // add ao SET diário; se 1 → primeira vez hoje
      const added = await redis.sadd(setKey, fp)
      // garante TTL de 2 dias no SET diário
      await redis.expire(setKey, 60 * 60 * 24 * 2)

      // opcional: contar hits crus do dia (sem dedupe) p/ debug
      await redis.incrby(hitsKey, 1)
      await redis.expire(hitsKey, 60 * 60 * 24 * 3)

      if (added === 1) {
        await redis.incrby(pendingKey, 1)
        // manter pending por ~1 semana; flush deve limpar
        await redis.expire(pendingKey, 60 * 60 * 24 * 7)
      }

      return reply.code(204).send()
    },
  )
}
