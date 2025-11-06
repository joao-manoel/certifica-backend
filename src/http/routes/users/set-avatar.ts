import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { auth } from "@/http/middlewares/auth"
import { prisma } from "@/lib/prisma"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import {
  uploadToS3,
  deleteFromS3,
  streamToBuffer,
  getSignedGetUrl,
} from "@/lib/s3"
import { env } from "@/env"

const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
])

export async function setAvatar(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      "/users/me/avatar",
      {
        schema: {
          tags: ["Users"],
          summary: "Define/atualiza o avatar do usuário autenticado",
          security: [{ bearerAuth: [] }],
          consumes: ["multipart/form-data"],
          response: {
            201: z.object({
              url: z.string().url(),
              expiresIn: z.number().int().positive(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const file = await request.file() // já funciona porque o plugin é global

        if (!file) throw new BadRequestError("Arquivo 'file' é obrigatório.")
        if (!ALLOWED_MIMES.has(file.mimetype)) {
          throw new BadRequestError(
            "Formato inválido. Use JPEG, PNG, WEBP ou AVIF.",
          )
        }
        if (file.file.truncated) {
          // estourou o limite do multipartConfig (25 MB)
          throw new BadRequestError("Arquivo excede o limite permitido.")
        }

        const buffer = await streamToBuffer(file.file)

        const current = await prisma.user.findUnique({
          where: { id: userId },
          select: { avatarKey: true, username: true },
        })

        const folder = `avatars/${userId}`
        const { key } = await uploadToS3(
          { buffer, filename: file.filename, mimetype: file.mimetype },
          folder,
        )

        await prisma.user.update({
          where: { id: userId },
          data: {
            avatarKey: key,
            avatarMime: file.mimetype,
            avatarUpdatedAt: new Date(),
          },
        })

        if (current?.avatarKey && current.avatarKey !== key) {
          try {
            await deleteFromS3(current.avatarKey)
          } catch {}
        }

        const expiresIn = 60
        const signedUrl = await getSignedGetUrl(key, expiresIn)
        return reply.code(201).send({ url: `${env.API_URL}/users/avatar/${current?.username}`, expiresIn })
      },
    )
}
