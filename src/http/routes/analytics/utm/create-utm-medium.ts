import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { slugify } from "@/utils/blog-utils"

export async function createUtmMedium(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/analytics/utm/medium",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Cria uma nova UTM Medium (meio)",
        body: z.object({
          name: z.string().trim().min(2).max(100),
        }),
        response: {
          201: z.object({
            id: z.string().uuid(),
            name: z.string(),
            slug: z.string(),
          }),
          409: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { name } = request.body
      const slug = slugify(name)

      const existing = await prisma.utmMedium.findUnique({ where: { slug } })
      if (existing) return reply.code(409).send({ message: "Medium já existe" })

      const medium = await prisma.utmMedium.create({
        data: { name, slug },
        select: { id: true, name: true, slug: true },
      })

      return reply.code(201).send(medium)
    },
  )
}
