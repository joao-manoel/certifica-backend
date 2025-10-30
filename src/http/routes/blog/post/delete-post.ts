import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { auth } from "@/http/middlewares/auth"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { Role } from "@prisma/client"

export async function deletePost(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      "/blog/posts/:id",
      {
        schema: {
          tags: ["Posts"],
          summary: "Delete a post",
          params: z.object({
            id: z.string().uuid(),
          }),
          response: {
            200: z.object({
              id: z.string().uuid(),
              deleted: z.literal(true),
            }),
            401: z.object({
              message: z.string(),
            }),
            404: z.object({
              message: z.string(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()

        // carrega role do usuário autenticado
        const me = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true },
        })

        if (!me) {
          throw new UnauthorizedError("Usuário não autenticado.")
        }

        // somente ADMIN ou EDITOR podem deletar
        if (me.role !== Role.ADMIN && me.role !== Role.EDITOR) {
          throw new UnauthorizedError(
            "Você não tem permissão para deletar posts.",
          )
        }

        const { id } = request.params

        // existe?
        const post = await prisma.post.findUnique({
          where: { id },
          select: { id: true, authorId: true },
        })
        if (!post) {
          throw new NotFoundError("Post não encontrado.")
        }

        if (me.role === Role.EDITOR && post.authorId !== me.id) {
          throw new UnauthorizedError(
            "Você não pode deletar posts de outros autores.",
          )
        }

        await prisma.post.delete({ where: { id } })

        return reply.status(200).send({ id, deleted: true })
      },
    )
}
