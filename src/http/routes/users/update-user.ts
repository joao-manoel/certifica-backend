import { FastifyInstance } from "fastify"
import { z } from "zod"
import { ZodTypeProvider } from "fastify-type-provider-zod"
import { apiKey } from "@/http/middlewares/api-key"
import { Role } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { auth } from "@/http/middlewares/auth"

export async function updateUser(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .register(apiKey)
    .put(
      "/user/:id",
      {
        schema: {
          summary: "Update user",
          tags: ["Users"],
          params: z.object({
            id: z.string().uuid(),
          }),
          body: z
            .object({
              name: z.string().min(1).optional(),
              username: z
                .string()
                .min(3, "username deve ter ao menos 3 caracteres")
                .max(32, "username deve ter no máximo 32 caracteres")
                .regex(/^[a-zA-Z0-9._-]+$/, "username inválido")
                .optional(),
              email: z.string().email().optional(),
              description: z.string().min(1).max(500).optional(),
              role: z.nativeEnum(Role).optional(),
            })
            .transform((data) => ({
              ...data,
              // normalização leve (evita espaços acidentais)
              name:
                typeof data.name === "string" ? data.name.trim() : undefined,
              username:
                typeof data.username === "string"
                  ? data.username.trim()
                  : undefined,
              email:
                typeof data.email === "string" ? data.email.trim() : undefined,
            })),
          response: {
            200: z.object({
              id: z.string().uuid(),
              username: z.string(),
              name: z.string().nullable(),
              email: z.string().email().nullable(),
              role: z.nativeEnum(Role),
              description: z.string().nullable(),
              createdAt: z.date(),
              updatedAt: z.date(),
            }),
          },
        },
      },
      async (request, reply) => {
        const authUserId = await request.getCurrentUserId()
        const authUser = await prisma.user.findUnique({
          where: { id: authUserId },
        })
        if (!authUser) throw new UnauthorizedError()

        const { id } = request.params

        // Só ADMIN ou o próprio usuário podem atualizar
        if (authUser.role !== Role.ADMIN && authUser.id !== id) {
          throw new UnauthorizedError(
            "você não tem permissão para atualizar este usuário.",
          )
        }

        const { name, role, username, email, description } = request.body

        const user = await prisma.user.findUnique({ where: { id } })
        if (!user) {
          throw new NotFoundError("Usuário não encontrado!")
        }

        // Apenas ADMIN pode alterar o role
        if (typeof role !== "undefined" && authUser.role !== Role.ADMIN) {
          throw new UnauthorizedError(
            "apenas administradores podem alterar o cargo.",
          )
        }

        // Unicidade de username (ignora o próprio id)
        if (username && username !== user.username) {
          const existingByUsername = await prisma.user.findFirst({
            where: { username, NOT: { id: user.id } },
          })
          if (existingByUsername) {
            // 409 seria o status semântico, mas mantendo padrão de erro do projeto:
            throw new UnauthorizedError(
              "já existe um usuário com este username.",
            )
          }
        }

        // Unicidade de email (ignora o próprio id)
        if (email && email !== user.email) {
          const existingByEmail = await prisma.user.findFirst({
            where: { email, NOT: { id: user.id } },
          })
          if (existingByEmail) {
            throw new UnauthorizedError("já existe um usuário com este e-mail.")
          }
        }

        // Monta objeto de atualização somente com campos definidos
        const dataToUpdate: {
          name?: string
          username?: string
          email?: string
          role?: Role
          description?: string
        } = {}

        if (typeof name !== "undefined") dataToUpdate.name = name
        if (typeof username !== "undefined") dataToUpdate.username = username
        if (typeof email !== "undefined") dataToUpdate.email = email
        if (typeof role !== "undefined") dataToUpdate.role = role
        if (typeof description !== "undefined")
          dataToUpdate.description = description

        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: dataToUpdate,
        })

        return reply.status(200).send(updatedUser)
      },
    )
}
