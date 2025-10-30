import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { auth } from "@/http/middlewares/auth"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import { Role } from "@prisma/client"
import { guessMimeTypeFromUrl, normalizeHexColor } from "@/utils/midia-utils"

export async function createMedia(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      "/blog/media",
      {
        schema: {
          tags: ["Media"],
          summary: "Create media (image) record",
          body: z.object({
            url: z.string().url().max(2048),
            alt: z.string().max(200).optional().nullable(),
            mimeType: z.string().max(100).optional().nullable(),
            width: z.number().int().positive().optional().nullable(),
            height: z.number().int().positive().optional().nullable(),
            dominantClr: z.string().max(12).optional().nullable(),
          }),
          response: {
            201: z.object({
              id: z.string().uuid(),
              url: z.string().url(),
              alt: z.string().nullable(),
              mimeType: z.string().nullable(),
              width: z.number().int().nullable(),
              height: z.number().int().nullable(),
              dominantClr: z.string().nullable(),
              createdAt: z.string().datetime(),
              updatedAt: z.string().datetime(),
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
        if (user.role !== Role.ADMIN && user.role !== Role.EDITOR) {
          throw new UnauthorizedError(
            "Você não tem permissão para cadastrar mídia.",
          )
        }

        const { url, alt, mimeType, width, height, dominantClr } = request.body

        // normalizações/validações adicionais
        const normalizedClr = normalizeHexColor(dominantClr)
        if (dominantClr && !normalizedClr) {
          throw new BadRequestError(
            "dominantClr inválido. Use #rgb, #rgba, #rrggbb ou #rrggbbaa.",
          )
        }

        let finalMime = mimeType?.trim() || null
        if (!finalMime) {
          finalMime = guessMimeTypeFromUrl(url)
        }

        // (Opcional) Evitar registros idênticos por URL — se preferir sempre criar, remova esse bloco
        const existing = await prisma.media.findFirst({ where: { url } })
        if (existing) {
          return reply.code(201).send({
            id: existing.id,
            url: existing.url,
            alt: existing.alt,
            mimeType: existing.mimeType,
            width: existing.width,
            height: existing.height,
            dominantClr: existing.dominantClr,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: existing.updatedAt.toISOString(),
          })
        }

        const created = await prisma.media.create({
          data: {
            url,
            alt: alt ?? null,
            mimeType: finalMime,
            width: width ?? null,
            height: height ?? null,
            dominantClr: normalizedClr,
          },
        })

        return reply.code(201).send({
          id: created.id,
          url: created.url,
          alt: created.alt,
          mimeType: created.mimeType,
          width: created.width,
          height: created.height,
          dominantClr: created.dominantClr,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        })
      },
    )
}
