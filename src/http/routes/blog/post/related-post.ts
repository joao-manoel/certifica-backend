import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { PostStatus, Visibility } from "@prisma/client"
import { isoOrNull } from "@/utils/blog-utils"

export async function getRelatedPosts(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/blog/posts/:identifier/related",
    {
      schema: {
        tags: ["Posts"],
        summary: "List related posts by id or slug",
        params: z.object({
          identifier: z.string().min(1),
        }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(20).default(6),
          // se quiser, pode deixar includeScheduled aqui, mas ele
          // não terá mais efeito. Estou removendo pra ficar limpo.
        }),
        response: {
          200: z.object({
            related: z.array(
              z.object({
                id: z.string().uuid(),
                title: z.string(),
                slug: z.string(),
                excerpt: z.string().nullable(),
                coverUrl: z.string().nullable(),
                publishedAt: z.string().datetime().nullable(),
                author: z.object({
                  id: z.string().uuid(),
                  name: z.string(),
                  username: z.string(),
                }),
                score: z.number().int(),
              }),
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      const { identifier } = request.params
      const { limit } = request.query

      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          identifier,
        )

      // 1) Post base (pode estar DRAFT; rota é pública mesmo assim)
      const basePost = await prisma.post.findFirst({
        where: isUUID ? { id: identifier } : { slug: identifier },
        include: {
          tags: { select: { tagId: true } },
          categories: { select: { categoryId: true } },
        },
      })
      if (!basePost) throw new NotFoundError("Post não encontrado.")

      const tagIds = basePost.tags.map((t) => t.tagId)
      const categoryIds = basePost.categories.map((c) => c.categoryId)
      const hasSignals = tagIds.length > 0 || categoryIds.length > 0

      // 2) Apenas posts PUBLIC + PUBLISHED
      const wherePublishedPublic = {
        id: { not: basePost.id },
        visibility: Visibility.PUBLIC,
        status: PostStatus.PUBLISHED,
        // se quiser garantir que só volte publicado com data setada:
        // publishedAt: { not: null },
      } as const

      const relatedCandidates = hasSignals
        ? await prisma.post.findMany({
            where: {
              ...wherePublishedPublic,
              OR: [
                tagIds.length
                  ? { tags: { some: { tagId: { in: tagIds } } } }
                  : undefined,
                categoryIds.length
                  ? {
                      categories: { some: { categoryId: { in: categoryIds } } },
                    }
                  : undefined,
              ].filter(Boolean) as any,
            },
            include: {
              author: { select: { id: true, name: true, username: true } },
              cover: { select: { url: true } },
              tags: { select: { tagId: true } },
              categories: { select: { categoryId: true } },
            },
            orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
            take: Math.max(limit * 3, 20),
          })
        : []

      // 3) Se não achou nada, FALLBACK: últimos posts PUBLIC + PUBLISHED
      const needsFallback = relatedCandidates.length === 0
      const fallbackPosts = needsFallback
        ? await prisma.post.findMany({
            where: { ...wherePublishedPublic },
            include: {
              author: { select: { id: true, name: true, username: true } },
              cover: { select: { url: true } },
              tags: { select: { tagId: true } },
              categories: { select: { categoryId: true } },
            },
            orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
            take: limit,
          })
        : []

      // 4) Score (2 por tag comum, 1 por categoria)
      const pool = needsFallback ? fallbackPosts : relatedCandidates
      const scored = pool
        .map((p) => {
          const commonTags = tagIds.length
            ? p.tags.reduce(
                (acc, t) => (tagIds.includes(t.tagId) ? acc + 1 : acc),
                0,
              )
            : 0
          const commonCats = categoryIds.length
            ? p.categories.reduce(
                (acc, c) =>
                  categoryIds.includes(c.categoryId) ? acc + 1 : acc,
                0,
              )
            : 0
          const score = needsFallback ? 0 : commonTags * 2 + commonCats * 1
          return { p, score }
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const aDate = a.p.publishedAt ?? a.p.updatedAt
          const bDate = b.p.publishedAt ?? b.p.updatedAt
          return (bDate?.getTime() ?? 0) - (aDate?.getTime() ?? 0)
        })
        .slice(0, limit)
        .map(({ p, score }) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          coverUrl: p.cover?.url ?? null,
          publishedAt: isoOrNull(p.publishedAt),
          author: p.author,
          score,
        }))

      return reply.send({ related: scored })
    },
  )
}
