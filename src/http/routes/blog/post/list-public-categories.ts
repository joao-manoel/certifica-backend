import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { PostStatus, Visibility } from "@prisma/client"
import { z } from "zod"

import { prisma } from "@/lib/prisma"

export async function listPublicCategories(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/blog/public/categories",
    {
      schema: {
        tags: ["Posts"],
        summary: "List categories used by public posts",
        response: {
          200: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              slug: z.string(),
              postCount: z.number().int().nonnegative(),
            }),
          ),
        },
      },
    },
    async (_request, reply) => {
      const categories = await prisma.category.findMany({
        where: {
          posts: {
            some: {
              post: {
                status: PostStatus.PUBLISHED,
                visibility: Visibility.PUBLIC,
              },
            },
          },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: {
            select: {
              posts: {
                where: {
                  post: {
                    status: PostStatus.PUBLISHED,
                    visibility: Visibility.PUBLIC,
                  },
                },
              },
            },
          },
        },
      })

      return reply.send(
        categories.map(({ _count, ...category }) => ({
          ...category,
          postCount: _count.posts,
        })),
      )
    },
  )
}
