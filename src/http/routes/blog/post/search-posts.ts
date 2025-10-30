import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, Visibility } from "@prisma/client"
import { isoOrNull } from "@/utils/blog-utils"

export async function searchPosts(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/posts/search",
      {
        schema: {
          tags: ["Posts"],
          summary: "Search posts (paginated)",
          querystring: z.object({
            q: z.string().min(1, "query vazia"),
            page: z.coerce.number().int().positive().default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(10),

            // filtros opcionais
            status: z.nativeEnum(PostStatus).optional(),
            visibility: z.nativeEnum(Visibility).optional(),
            authorId: z.string().uuid().optional(),
            category: z.string().optional(), // slug ou nome
            tag: z.string().optional(),      // slug ou nome

            // ordenação
            sort: z.enum(["relevance", "publishedAt", "createdAt"]).default("relevance"),
            orderDir: z.enum(["asc", "desc"]).default("desc"),
          }),
          response: {
            200: z.object({
              total: z.number().int(),
              page: z.number().int(),
              pageSize: z.number().int(),
              items: z.array(
                z.object({
                  id: z.string().uuid(),
                  title: z.string(),
                  slug: z.string(),
                  excerpt: z.string().nullable(),
                  status: z.nativeEnum(PostStatus),
                  visibility: z.nativeEnum(Visibility),
                  publishedAt: z.string().datetime().nullable(),
                  scheduledFor: z.string().datetime().nullable(),
                  wordCount: z.number().int(),
                  readTime: z.number().int(),
                  coverUrl: z.string().nullable(),
                  createdAt: z.string().datetime(),
                  updatedAt: z.string().datetime(),
                  author: z.object({
                    id: z.string().uuid(),
                    name: z.string(),
                    username: z.string(),
                  }),
                })
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

        const {
          q,
          page,
          pageSize,
          status,
          visibility,
          authorId,
          category,
          tag,
          sort,
          orderDir,
        } = request.query

        const skip = (page - 1) * pageSize

        // filtro base
        const where: any = {
          AND: [],
        }

        // restrição de papel: USER só vê publicados e públicos
        if (user.role === Role.USER) {
          where.AND.push({ status: PostStatus.PUBLISHED })
          where.AND.push({ visibility: Visibility.PUBLIC })
        } else {
          if (status) where.AND.push({ status })
          if (visibility) where.AND.push({ visibility })
        }

        if (authorId) where.AND.push({ authorId })

        // Busca textual básica (case-insensitive) em título/slug/excerpt
        const textFilter = {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { excerpt: { contains: q, mode: "insensitive" } },
          ],
        }
        where.AND.push(textFilter)

        // Filtro por categoria/tag (aceita slug OU nome)
        if (category) {
          where.AND.push({
            OR: [
              { categories: { some: { category: { slug: { equals: category, mode: "insensitive" } } } } },
              { categories: { some: { category: { name: { contains: category, mode: "insensitive" } } } } },
            ],
          })
        }
        if (tag) {
          where.AND.push({
            OR: [
              { tags: { some: { tag: { slug: { equals: tag, mode: "insensitive" } } } } },
              { tags: { some: { tag: { name: { contains: tag, mode: "insensitive" } } } } },
            ],
          })
        }

        // Ordenação
        // "relevance" aqui usa um fallback temporal; para FTS real use $queryRaw com ts_rank no Postgres.
        const orderBy =
          sort === "relevance"
            ? [{ publishedAt: "desc" as const }, { createdAt: "desc" as const }]
            : [{ [sort]: orderDir }]

        const [total, posts] = await prisma.$transaction([
          prisma.post.count({ where }),
          prisma.post.findMany({
            where,
            skip,
            take: pageSize,
            orderBy,
            include: {
              author: { select: { id: true, name: true, username: true } },
              cover: { select: { url: true } },
            },
          }),
        ])

        return reply.send({
          total,
          page,
          pageSize,
          items: posts.map((p) => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            excerpt: p.excerpt,
            status: p.status,
            visibility: p.visibility,
            publishedAt: isoOrNull(p.publishedAt),
            scheduledFor: isoOrNull(p.scheduledFor),
            wordCount: p.wordCount,
            readTime: p.readTime,
            coverUrl: p.cover?.url ?? null,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
            author: p.author,
          })),
        })
      }
    )
}
