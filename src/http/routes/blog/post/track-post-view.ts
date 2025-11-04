import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { redis } from "@/lib/redis"
import { PostStatus, ViewStatus, Visibility } from "@prisma/client"
import { hashIp, isBotUA, parseClientHints, yyyymmdd } from "@/utils/metrics"

export async function trackPostView(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/blog/posts/:slug/view",
    {
      schema: {
        tags: ["Posts"],
        summary: "Track a post view (DB first, Redis dedupe) — sem UTM",
        params: z.object({ slug: z.string().min(1) }),
        body: z
          .object({
            fp: z.string().min(16).max(128).optional(), // fingerprint diário do client
            path: z.string().max(200).optional(), // caminho da página (opcional)
          })
          .optional(),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const { slug } = request.params
      const body = request.body ?? {}

      // headers/client info
      const ua = (request.headers["user-agent"] as string) ?? ""
      const referrer =
        (request.headers["referer"] as string) ||
        (request.headers["referrer"] as string) ||
        undefined
      const ipHeader = (request.headers["x-forwarded-for"] as string)
        ?.split(",")[0]
        ?.trim()
      const ip = ipHeader || request.ip || "0.0.0.0"

      // valida post elegível
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

      const day = yyyymmdd()
      const ipH = hashIp(ip)
      const bot = isBotUA(ua)
      const { device, browser, os } = parseClientHints(ua)

      // 1) cria PostView como PENDING (grava metadados básicos)
      const view = await prisma.postView.create({
        data: {
          postId: post.id,
          status: ViewStatus.PENDING,
          day,
          ipHash: ipH,
          ua: ua.slice(0, 300),
          referrer: referrer?.slice(0, 300),
          path: body.path?.slice(0, 200),
          fingerprint: body.fp,
          isBot: bot,
          device,
          browser,
          os,
        },
        select: { id: true },
      })

      // 2) bots não contam: apaga a view e finaliza
      if (bot) {
        await prisma.postView.delete({ where: { id: view.id } })
        return reply.code(204).send()
      }

      // 3) dedupe diária no Redis
      const fpKeyPart =
        body.fp && body.fp.length >= 16 ? body.fp : `${ipH}:${day}`
      const setKey = `pv:u:${post.id}:${day}`
      const pendingKey = `pv:pending:${post.id}`

      try {
        const added = await redis.sadd(setKey, fpKeyPart)
        await redis.expire(setKey, 60 * 60 * 24 * 2)

        if (added === 1) {
          // primeira vez hoje → conta
          await redis.incrby(pendingKey, 1)
          await redis.expire(pendingKey, 60 * 60 * 24 * 7)
          // mantém a PostView PENDING para o flush marcar APPLIED
        } else {
          // duplicata → apaga a PostView recém-criada
          await prisma.postView.delete({ where: { id: view.id } })
        }
      } catch {
        // erro de Redis → apaga a PostView (evita órfãos)
        await prisma.postView.delete({ where: { id: view.id } })
      }

      return reply.code(204).send()
    },
  )
}
