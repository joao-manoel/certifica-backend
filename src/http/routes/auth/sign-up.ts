import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"
import bcrypt from "bcrypt"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { Role } from "@prisma/client"
import { auth } from "@/http/middlewares/auth"

export async function signUp(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      "/auth/sign-up",
      {
        schema: {
          tags: ["Auth"],
          summary: "Register route",
          body: z.object({
            username: z.string(),
            name: z.string(),
            email: z.string().email().optional(),
            role: z.enum(Role).optional(),
            password: z.string(),
          }),
          response: {
            201: z.object({
              id: z.string(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { email, name, username, role, password } = request.body

        const requestingUser = await prisma.user.findUnique({
          where: { id: userId },
        })

        if (requestingUser?.role !== Role.ADMIN) {
          throw new UnauthorizedError(
            "Apenas Administradores podem criar novos usuários.",
          )
        }

        const existingUsername = await prisma.user.findUnique({
          where: { username },
        })

        if (existingUsername) {
          throw new UnauthorizedError("Username already taken.")
        }

        const existingEmail = await prisma.user.findUnique({
          where: { email },
        })

        if (existingEmail) {
          throw new UnauthorizedError("Email already taken.")
        }

        const hashedPassword = await bcrypt.hash(password, 10)

        const user = await prisma.user.create({
          data: {
            username,
            name,
            email,
            role: role || Role.USER,
            password: hashedPassword,
          },
        })

        if (!user) {
          throw new UnauthorizedError("Error creating user.")
        }

        reply.send({ id: user.id })
      },
    )
}
