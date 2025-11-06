import { FastifyInstance } from "fastify"
import { z } from "zod"
import { ZodTypeProvider } from "fastify-type-provider-zod"
import { apiKey } from "@/http/middlewares/api-key"
import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import bcrypt from "bcrypt"

export async function updateUserPassword(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .register(apiKey)
    .put(
      "/user/password",
      {
        schema: {
          summary: "Change current user's password",
          tags: ["Users"],
          body: z
            .object({
              currentPassword: z.string().min(1, "informe a senha atual"),
              newPassword: z
                .string()
                .min(8, "nova senha deve ter ao menos 8 caracteres")
                .max(128, "nova senha muito longa"),
              confirmPassword: z.string().min(1, "confirme a nova senha"),
            })
            .transform((data) => ({
              currentPassword: data.currentPassword.trim(),
              newPassword: data.newPassword.trim(),
              confirmPassword: data.confirmPassword.trim(),
            })),
          response: {
            200: z.object({
              id: z.string().uuid(),
              updatedAt: z.date(),
            }),
          },
        },
      },
      async (request, reply) => {
        const authUserId = await request.getCurrentUserId()
        if (!authUserId) {
          throw new UnauthorizedError()
        }

        const { currentPassword, newPassword, confirmPassword } = request.body

        // Confirmar nova senha
        if (newPassword !== confirmPassword) {
          throw new UnauthorizedError(
            "confirmação não confere com a nova senha.",
          )
        }

        const user = await prisma.user.findUnique({ where: { id: authUserId } })
        if (!user) {
          // Em teoria não deveria ocorrer se o token foi emitido corretamente
          throw new UnauthorizedError()
        }

        // Validar senha atual
        const ok = await bcrypt.compare(currentPassword, user.password)
        if (!ok) {
          throw new UnauthorizedError("senha atual inválida.")
        }

        // Evitar reutilizar a mesma senha
        const isSame = await bcrypt.compare(newPassword, user.password)
        if (isSame) {
          throw new UnauthorizedError(
            "a nova senha não pode ser igual à senha atual.",
          )
        }

        // Hash e update
        const hashed = await bcrypt.hash(newPassword, 10)

        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { password: hashed },
          select: { id: true, updatedAt: true },
        })

        return reply.status(200).send(updated)
      },
    )
}
