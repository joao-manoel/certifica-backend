import { randomUUID } from "node:crypto"

import { Role } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import sharp from "sharp"

import { BadRequestError } from "@/http/_errors/bad-request-error"
import { PayloadTooLargeError } from "@/http/_errors/payload-too-large-error"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { UnsupportedMediaTypeError } from "@/http/_errors/unsupported-media-type-error"
import { apiKey } from "@/http/middlewares/api-key"
import { auth } from "@/http/middlewares/auth"
import {
  mediaResponseSchema,
  serializeMedia,
} from "@/http/routes/blog/media/media-response"
import { getMediaDeliveryUrl } from "@/http/routes/blog/media/media-url"
import { deleteFromS3, streamToBuffer, uploadToS3 } from "@/lib/s3"
import { prisma } from "@/lib/prisma"
import { writeAuditLog } from "@/lib/audit"
import {
  findIdempotentResponse,
  hashPayload,
  saveIdempotentResponse,
} from "@/lib/idempotency"

const MAX_FILE_SIZE = 25 * 1024 * 1024
const CACHE_CONTROL = "public, max-age=31536000, immutable"
const MIME_BY_FORMAT = {
  jpeg: { mimeType: "image/jpeg", extension: ".jpg" },
  png: { mimeType: "image/png", extension: ".png" },
  webp: { mimeType: "image/webp", extension: ".webp" },
} as const

type SupportedFormat = keyof typeof MIME_BY_FORMAT

export async function uploadMedia(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(apiKey)
    .register(auth)
    .post(
      "/blog/media/upload",
      {
        schema: {
          tags: ["Media"],
          summary: "Upload an image to S3 and create a media record",
          security: [{ bearerAuth: [] }],
          consumes: ["multipart/form-data"],
          response: {
            201: mediaResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const context = await request.requireScopes(["media:write"])
        const userId = context.userId
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        })

        if (!user) throw new UnauthorizedError("Usuário não autenticado.")
        if (user.role !== Role.ADMIN && user.role !== Role.EDITOR) {
          throw new UnauthorizedError(
            "Você não tem permissão para cadastrar mídia.",
          )
        }

        let alt: string | null = null
        let uploadedFile:
          | { buffer: Buffer; filename: string; declaredMimeType: string }
          | undefined

        const parts = request.parts({
          limits: {
            fileSize: MAX_FILE_SIZE,
            files: 1,
            fields: 1,
            parts: 2,
          },
        })

        for await (const part of parts) {
          if (part.type === "file") {
            if (part.fieldname !== "file") {
              throw new BadRequestError(
                "O arquivo deve ser enviado no campo 'file'.",
              )
            }

            const buffer = await streamToBuffer(part.file)
            if (part.file.truncated || buffer.length > MAX_FILE_SIZE) {
              throw new PayloadTooLargeError(
                "A imagem deve ter no máximo 25 MB.",
              )
            }
            if (buffer.length === 0) {
              throw new BadRequestError("O arquivo enviado está vazio.")
            }

            uploadedFile = {
              buffer,
              filename: part.filename,
              declaredMimeType: part.mimetype,
            }
          } else if (part.fieldname === "alt") {
            const value = String(part.value).trim()
            if (value.length > 200) {
              throw new BadRequestError(
                "O texto alternativo deve ter no máximo 200 caracteres.",
              )
            }
            alt = value || null
          } else {
            throw new BadRequestError(
              `Campo '${part.fieldname}' não suportado.`,
            )
          }
        }

        if (!uploadedFile) {
          throw new BadRequestError("Arquivo 'file' é obrigatório.")
        }

        const idempotencyKey = request.headers["idempotency-key"] as
          | string
          | undefined
        const requestHash = hashPayload({
          alt,
          file: uploadedFile.buffer.toString("base64"),
        })
        const replay = await findIdempotentResponse(
          context.apiClientId,
          idempotencyKey,
          "upload-media",
          requestHash,
        )
        if (replay) {
          return reply.code(201).send(replay.response as never)
        }

        let processed: Buffer
        let info: sharp.OutputInfo
        try {
          const result = await sharp(uploadedFile.buffer)
            .rotate()
            .toBuffer({ resolveWithObject: true })
          processed = result.data
          info = result.info
        } catch {
          throw new UnsupportedMediaTypeError(
            "Arquivo inválido. Use uma imagem JPEG, PNG ou WebP.",
          )
        }

        const format = info.format as SupportedFormat
        const detected = MIME_BY_FORMAT[format]
        if (!detected) {
          throw new UnsupportedMediaTypeError(
            "Formato não suportado. Use JPEG, PNG ou WebP.",
          )
        }
        if (uploadedFile.declaredMimeType !== detected.mimeType) {
          throw new UnsupportedMediaTypeError(
            "O tipo declarado do arquivo não corresponde ao conteúdo da imagem.",
          )
        }

        const stats = await sharp(processed).stats()
        const dominantClr = `#${[
          stats.dominant.r,
          stats.dominant.g,
          stats.dominant.b,
        ]
          .map((channel) => channel.toString(16).padStart(2, "0"))
          .join("")}`

        const { key } = await uploadToS3(
          {
            buffer: processed,
            filename: `upload${detected.extension}`,
            mimetype: detected.mimeType,
            cacheControl: CACHE_CONTROL,
          },
          "blog/media",
        )

        try {
          const mediaId = randomUUID()
          const created = await prisma.media.create({
            data: {
              id: mediaId,
              url: getMediaDeliveryUrl(mediaId),
              source: "S3",
              storageKey: key,
              alt,
              mimeType: detected.mimeType,
              width: info.width,
              height: info.height,
              dominantClr,
            },
          })

          const response = serializeMedia(created)
          await saveIdempotentResponse({
            apiClientId: context.apiClientId,
            key: idempotencyKey,
            operation: "upload-media",
            requestHash,
            statusCode: 201,
            response,
          })
          await writeAuditLog(context, "media.upload", "Media", created.id, {
            storageKey: key,
            mimeType: detected.mimeType,
            width: info.width,
            height: info.height,
          })

          return reply.code(201).send(response)
        } catch (error) {
          try {
            await deleteFromS3(key)
          } catch {
            request.log.error(
              { storageKey: key },
              "Falha ao remover upload órfão do S3",
            )
          }
          throw error
        }
      },
    )
}
