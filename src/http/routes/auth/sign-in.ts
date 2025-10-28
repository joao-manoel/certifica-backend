import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"
import bcrypt from "bcrypt"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { Role } from "@prisma/client"

export async function signIn(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/auth/sign-in",
    {
      schema: {
        tags: ["Auth"],
        summary: "Authenticate route",
        body: z.object({
          username: z.string(),
          password: z.string(),
        }),
        response: {
          201: z.object({
            token: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body

      const user = await prisma.user.findUnique({
        where: {
          username,
        },
      })

      if (!user) {
        throw new UnauthorizedError("username ou senha inválidos.")
      }

      const isValid = await bcrypt.compare(password, user.password)

      if (!isValid) {
        throw new UnauthorizedError("username ou senha inválidos.")
      }

      if (user.role !== Role.ADMIN && user.role !== Role.MOD) {
        throw new UnauthorizedError(
          "Você não tem permissão para acessar o sistema.",
        )
      }

      const token = await reply.jwtSign(
        {
          sub: user.id,
        },
        {
          sign: {
            expiresIn: "7d",
          },
        },
      )

      reply.send({ token })
    },
  )
}
