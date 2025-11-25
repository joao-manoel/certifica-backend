import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { PostStatus, Visibility } from "@prisma/client"
import { isoOrNull } from "@/utils/blog-utils"

export async function listPublicPosts(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/blog/public/posts",
    {
      schema: {
        tags: ["Posts"],
        summary: "List posts (paginated)",
        querystring: z.object({
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(10),
          authorId: z.string().uuid().optional(),
          category: z.string().optional(), // slug da categoria
          tag: z.string().optional(), // slug da tag

          orderBy: z.enum(["createdAt", "publishedAt"]).default("publishedAt"),
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
                views: z.number().int(),
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
                  hasAvatar: z.boolean(),
                  bio: z.string().nullable(),
                }),

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
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      const { page, pageSize, authorId, category, tag, orderBy, orderDir } =
        request.query

      const skip = (page - 1) * pageSize

      const where: any = {}
      if (authorId) where.authorId = authorId
      if (category) {
        where.categories = {
          some: { category: { slug: category } },
        }
      }
      if (tag) {
        where.tags = {
          some: { tag: { slug: tag } },
        }
      }

      where.status = PostStatus.PUBLISHED
      where.visibility = Visibility.PUBLIC

      const [total, items] = await prisma.$transaction([
        prisma.post.count({ where }),
        prisma.post.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { [orderBy]: orderDir },
          select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            status: true,
            views: true,
            visibility: true,
            publishedAt: true,
            scheduledFor: true,
            wordCount: true,
            readTime: true,
            createdAt: true,
            updatedAt: true,

            author: {
              select: {
                id: true,
                name: true,
                username: true,
                avatarKey: true,
                description: true,
              },
            },
            cover: { select: { url: true } },

            categories: {
              select: {
                category: { select: { id: true, name: true, slug: true } },
              },
            },
            tags: {
              select: {
                tag: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        }),
      ])

      return reply.send({
        total,
        page,
        pageSize,
        items: items.map((p) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          status: p.status,
          views: p.views,
          visibility: p.visibility,
          publishedAt: isoOrNull(p.publishedAt),
          scheduledFor: isoOrNull(p.scheduledFor),
          wordCount: p.wordCount,
          readTime: p.readTime,
          coverUrl: p.cover?.url ?? null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          author: {
            id: p.author.id,
            name: p.author.name,
            username: p.author.username,
            hasAvatar: !!p.author.avatarKey,
            bio: p.author.description,
          },

          // >>> projeção no formato esperado pelo front
          categories: p.categories.map(({ category }) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
          })),
          tags: p.tags.map(({ tag }) => ({
            id: tag.id,
            name: tag.name,
            slug: tag.slug,
          })),
        })),
      })
    },
  )
}
