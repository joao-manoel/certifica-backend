import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { auth } from "@/http/middlewares/auth"
import { prisma } from "@/lib/prisma"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import { Role } from "@prisma/client"

export async function getProfile(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/auth/profile",
      {
        schema: {
          tags: ["Auth"],
          summary: "Get authenticated user profile",
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                name: z.string().nullable(),
                email: z.string().email().nullable(),
                description: z.string().nullable(),
                role: z.nativeEnum(Role),
              }),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()

        const user = await prisma.user.findUnique({
          select: {
            id: true,
            username: true,
            description: true,
            name: true,
            email: true,
            role: true,
          },
          where: {
            id: userId,
          },
        })

        if (!user) {
          throw new BadRequestError("User not found.")
        }

        return reply.send({
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            description: user.description,
            role: user.role,
          },
        })
      },
    )
}
