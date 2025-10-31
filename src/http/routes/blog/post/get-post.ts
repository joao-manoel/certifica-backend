import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, Visibility } from "@prisma/client"
import { isoOrNull } from "@/utils/blog-utils"

export async function getPost(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/blog/posts/:identifier",
    {
      schema: {
        tags: ["Posts"],
        summary: "Get post by id or slug",
        params: z.object({
          identifier: z.string().min(1),
        }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            title: z.string(),
            slug: z.string(),
            excerpt: z.string().nullable(),
            content: z.any(),
            status: z.nativeEnum(PostStatus),
            visibility: z.nativeEnum(Visibility),
            publishedAt: z.string().datetime().nullable(),
            scheduledFor: z.string().datetime().nullable(),
            wordCount: z.number().int(),
            readTime: z.number().int(),
            createdAt: z.string().datetime(),
            updatedAt: z.string().datetime(),
            author: z.object({
              id: z.string().uuid(),
              name: z.string(),
              username: z.string(),
            }),
            coverUrl: z.string().nullable(),
            categories: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                slug: z.string(),
              }),
            ),
            tags: z.array(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                slug: z.string(),
              }),
            ),
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

      const { identifier } = request.params

      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          identifier,
        )

      const where = isUUID ? { id: identifier } : { slug: identifier }

      const post = await prisma.post.findFirst({
        where,
        include: {
          author: { select: { id: true, name: true, username: true } },
          cover: { select: { url: true } },
          categories: {
            include: { category: true },
          },
          tags: {
            include: { tag: true },
          },
        },
      })

      if (!post) throw new NotFoundError("Post não encontrado.")

      // restrição para USER: só vê PUBLIC + PUBLISHED
      if (user.role === Role.USER) {
        if (
          post.status !== PostStatus.PUBLISHED ||
          post.visibility !== Visibility.PUBLIC
        ) {
          throw new UnauthorizedError(
            "Você não tem permissão para ver este post.",
          )
        }
      }

      return reply.send({
        id: post.id,
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        status: post.status,
        visibility: post.visibility,
        publishedAt: isoOrNull(post.publishedAt),
        scheduledFor: isoOrNull(post.scheduledFor),
        wordCount: post.wordCount,
        readTime: post.readTime,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        author: post.author,
        coverUrl: post.cover?.url ?? null,
        categories: post.categories.map((c) => ({
          id: c.category.id,
          name: c.category.name,
          slug: c.category.slug,
        })),
        tags: post.tags.map((t) => ({
          id: t.tag.id,
          name: t.tag.name,
          slug: t.tag.slug,
        })),
      })
    },
  )
}
