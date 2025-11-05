import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus /*, Visibility */ } from "@prisma/client"

export async function getPostStats(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/posts/stats",
      {
        schema: {
          tags: ["Posts"],
          summary: "Totais de posts (total, publicados, rascunhos)",
          response: {
            200: z.object({
              total: z.number().int().nonnegative(),
              published: z.number().int().nonnegative(),
              drafts: z.number().int().nonnegative(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true },
        })

        if (!user) throw new UnauthorizedError("Usuário não autenticado.")
        if (user.role !== Role.ADMIN && user.role !== Role.EDITOR) {
          throw new UnauthorizedError(
            "Você não tem permissão para consultar estatísticas.",
          )
        }

        // Se quiser contar somente publicados PUBLIC, troque o where de 'published' por:
        // { status: PostStatus.PUBLISHED, visibility: Visibility.PUBLIC }
        const [total, published, drafts] = await prisma.$transaction([
          prisma.post.count(),
          prisma.post.count({ where: { status: PostStatus.PUBLISHED } }),
          prisma.post.count({ where: { status: PostStatus.DRAFT } }),
        ])

        return reply.send({ total, published, drafts })
      },
    )
}
