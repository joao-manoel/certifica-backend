// src/http/get-post-by-id.ts
import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { auth } from "@/http/middlewares/auth"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { isoOrNull } from "@/utils/blog-utils"

export async function getPostById(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/admin/posts/:id",
      {
        schema: {
          tags: ["Posts"],
          summary: "Get a post by ID",
          params: z.object({ id: z.string().uuid() }),
          response: {
            200: z.object({
              id: z.string().uuid(),
              title: z.string(),
              slug: z.string(),
              excerpt: z.string().nullable(),
              content: z.any(),
              coverId: z.string().uuid().nullable(),
              coverUrl: z.string().url().nullable(),
              status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED"]),
              visibility: z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]),
              publishedAt: z.string().datetime().nullable(),
              scheduledFor: z.string().datetime().nullable(),
              wordCount: z.number().int(),
              readTime: z.number().int(),
              createdAt: z.string().datetime(),
              updatedAt: z.string().datetime(),
              categories: z.array(
                z.object({ name: z.string(), slug: z.string() }),
              ),
              tags: z.array(z.object({ name: z.string(), slug: z.string() })),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        if (!userId) throw new UnauthorizedError("Usuário não autenticado.")

        const { id } = request.params

        const post = await prisma.post.findUnique({
          where: { id },
          select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            content: true,
            coverId: true,
            status: true,
            visibility: true,
            publishedAt: true,
            scheduledFor: true,
            wordCount: true,
            readTime: true,
            createdAt: true,
            updatedAt: true,
            cover: { select: { url: true } },
            categories: {
              select: { category: { select: { name: true, slug: true } } },
              orderBy: { category: { name: "asc" } },
            },
            tags: {
              select: { tag: { select: { name: true, slug: true } } },
              orderBy: { tag: { name: "asc" } },
            },
          },
        })

        if (!post) throw new BadRequestError("Post não encontrado.")

        return reply.code(200).send({
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt,
          content: post.content,
          coverId: post.coverId,
          coverUrl: post.cover?.url ?? null,
          status: post.status,
          visibility: post.visibility,
          publishedAt: isoOrNull(post.publishedAt),
          scheduledFor: isoOrNull(post.scheduledFor),
          wordCount: post.wordCount,
          readTime: post.readTime,
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
          // se não houver vínculos, retorna []
          categories: (post.categories ?? []).map((c) => c.category),
          tags: (post.tags ?? []).map((t) => t.tag),
        })
      },
    )
}
