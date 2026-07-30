import { randomUUID } from "node:crypto"

import { Role } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import sharp from "sharp"
import { z } from "zod"

import type { EditorContext } from "@/@types/fastify"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import { ConflictError } from "@/http/_errors/conflict-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { PayloadTooLargeError } from "@/http/_errors/payload-too-large-error"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import {
  mediaResponseSchema,
  serializeMedia,
} from "@/http/routes/blog/media/media-response"
import {
  findMediaUsages,
  replaceMediaUrls,
} from "@/http/routes/blog/media/media-usage"
import { getMediaPublicUrl } from "@/http/routes/blog/media/media-url"
import { writeAuditLog } from "@/lib/audit"
import { optimizeBlogImage } from "@/lib/optimize-blog-image"
import { prisma } from "@/lib/prisma"
import {
  deleteFromS3,
  getObjectBuffer,
  streamToBuffer,
  uploadToS3,
} from "@/lib/s3"
import { guessMimeTypeFromUrl } from "@/utils/midia-utils"

const MAX_FILE_SIZE = 25 * 1024 * 1024
const CACHE_CONTROL = "public, max-age=31536000, immutable"
const metadataSchema = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  alt: z.string().trim().max(500).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  credit: z.string().trim().max(300).nullable().optional(),
  url: z.string().url().max(2048).optional(),
})
const usageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  kind: z.enum(["cover", "body"]),
})

async function requireMediaEditor(
  request: {
    requireScopes: (scopes: ["media:read"] | ["media:write"]) => Promise<{
      userId: string
      apiClientId: string | null
      scopes: string[]
      kind: "user" | "integration"
    }>
  },
  write = false,
) {
  const context = await request.requireScopes([
    write ? "media:write" : "media:read",
  ] as ["media:write"] | ["media:read"])
  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: { role: true },
  })
  if (!user) throw new UnauthorizedError("Usuário não autenticado.")
  if (user.role !== Role.ADMIN && user.role !== Role.EDITOR) {
    throw new UnauthorizedError("Você não tem permissão para gerenciar mídia.")
  }
  return context as EditorContext
}

export async function manageMedia(app: FastifyInstance) {
  const secured = app.withTypeProvider<ZodTypeProvider>().register(auth)

  secured.get(
    "/blog/media/:id",
    {
      schema: {
        tags: ["Media"],
        summary: "Get media details and usages",
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: mediaResponseSchema.extend({
            usageCount: z.number().int(),
            coverUsageCount: z.number().int(),
            bodyUsageCount: z.number().int(),
            canEditImage: z.boolean(),
            canDelete: z.boolean(),
            usages: z.array(usageSchema),
            versions: z.array(
              z.object({
                id: z.string().uuid(),
                url: z.string().url(),
                mimeType: z.string(),
                width: z.number().int(),
                height: z.number().int(),
                fileSizeBytes: z.number().int(),
                isCurrent: z.boolean(),
                createdAt: z.string().datetime(),
              }),
            ),
          }),
        },
      },
    },
    async (request, reply) => {
      await requireMediaEditor(request)
      const media = await prisma.media.findUnique({
        where: { id: request.params.id },
        include: { versions: { orderBy: { createdAt: "desc" } } },
      })
      if (!media) throw new NotFoundError("Mídia não encontrada.")
      const usages = await findMediaUsages(media.id, [
        media.url,
        ...media.versions.map((version) => version.url),
      ])
      const coverUsageCount = usages.filter(
        (usage) => usage.kind === "cover",
      ).length
      const bodyUsageCount = usages.filter(
        (usage) => usage.kind === "body",
      ).length
      return reply.send({
        ...serializeMedia(media),
        usageCount: usages.length,
        coverUsageCount,
        bodyUsageCount,
        canEditImage: media.source === "S3",
        canDelete: usages.length === 0,
        usages,
        versions: media.versions.map((version) => ({
          ...version,
          createdAt: version.createdAt.toISOString(),
        })),
      })
    },
  )

  secured.patch(
    "/blog/media/:id",
    {
      schema: {
        tags: ["Media"],
        summary: "Update media metadata",
        params: z.object({ id: z.string().uuid() }),
        body: metadataSchema,
        response: { 200: mediaResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await requireMediaEditor(request, true)
      const current = await prisma.media.findUnique({
        where: { id: request.params.id },
      })
      if (!current) throw new NotFoundError("Mídia não encontrada.")
      if (request.body.url && current.source !== "EXTERNAL") {
        throw new BadRequestError(
          "A URL de uma mídia hospedada não pode ser alterada.",
        )
      }
      const updated = await prisma.media.update({
        where: { id: current.id },
        data: {
          ...request.body,
          mimeType: request.body.url
            ? guessMimeTypeFromUrl(request.body.url)
            : undefined,
        },
      })
      await writeAuditLog(context, "media.update", "Media", updated.id, {
        before: serializeMedia(current),
        after: serializeMedia(updated),
      })
      return reply.send(serializeMedia(updated))
    },
  )

  secured.post(
    "/blog/media/:id/transform",
    {
      schema: {
        tags: ["Media"],
        summary: "Create and activate a transformed media version",
        params: z.object({ id: z.string().uuid() }),
        consumes: ["multipart/form-data"],
        response: { 200: mediaResponseSchema },
      },
    },
    async (request, reply) => {
      const context = await requireMediaEditor(request, true)
      const current = await prisma.media.findUnique({
        where: { id: request.params.id },
        include: { versions: true },
      })
      if (!current) throw new NotFoundError("Mídia não encontrada.")
      if (current.source !== "S3" || !current.storageKey) {
        throw new BadRequestError(
          "Somente mídia hospedada pode ser transformada.",
        )
      }

      const fields: Record<string, string> = {}
      let replacement: { buffer: Buffer; filename: string } | null = null
      for await (const part of request.parts({
        limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 12, parts: 13 },
      })) {
        if (part.type === "file") {
          const buffer = await streamToBuffer(part.file)
          if (part.file.truncated || buffer.length > MAX_FILE_SIZE) {
            throw new PayloadTooLargeError("A imagem deve ter no máximo 25 MB.")
          }
          replacement = { buffer, filename: part.filename }
        } else {
          fields[part.fieldname] = String(part.value)
        }
      }

      const rotate = z.coerce
        .number()
        .refine((value) => [0, 90, 180, 270].includes(value))
        .parse(fields.rotate ?? 0)
      const source =
        replacement?.buffer ?? (await getObjectBuffer(current.storageKey))
      let pipeline = sharp(source, { failOn: "error" }).rotate(rotate)
      if (fields.flipHorizontal === "true") pipeline = pipeline.flop()
      if (fields.flipVertical === "true") pipeline = pipeline.flip()
      if (fields.cropLeft !== undefined) {
        const crop = z
          .object({
            left: z.coerce.number().int().min(0),
            top: z.coerce.number().int().min(0),
            width: z.coerce.number().int().positive(),
            height: z.coerce.number().int().positive(),
          })
          .parse({
            left: fields.cropLeft,
            top: fields.cropTop,
            width: fields.cropWidth,
            height: fields.cropHeight,
          })
        pipeline = pipeline.extract(crop)
      }

      let optimized
      try {
        optimized = await optimizeBlogImage(await pipeline.png().toBuffer())
      } catch {
        throw new BadRequestError("Não foi possível aplicar a transformação.")
      }
      const stats = await sharp(optimized.buffer).stats()
      const dominantClr = `#${[
        stats.dominant.r,
        stats.dominant.g,
        stats.dominant.b,
      ]
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`
      const uploaded = await uploadToS3(
        {
          buffer: optimized.buffer,
          filename: "transform.jpg",
          mimetype: optimized.mimeType,
          cacheControl: CACHE_CONTROL,
        },
        "blog/media",
      )
      const targetUrl = getMediaPublicUrl(uploaded.key)
      const historicalUrls = [
        current.url,
        ...current.versions.map((version) => version.url),
      ]
      const posts = await prisma.post.findMany({
        select: { id: true, content: true },
      })
      const postUpdates = posts
        .map((post) => ({
          id: post.id,
          content: replaceMediaUrls(post.content, historicalUrls, targetUrl),
        }))
        .filter((post) => post.content !== null)

      try {
        await prisma.$transaction([
          prisma.mediaVersion.updateMany({
            where: { mediaId: current.id, isCurrent: true },
            data: { isCurrent: false },
          }),
          prisma.mediaVersion.create({
            data: {
              id: randomUUID(),
              mediaId: current.id,
              url: targetUrl,
              storageKey: uploaded.key,
              mimeType: optimized.mimeType,
              width: optimized.width,
              height: optimized.height,
              fileSizeBytes: optimized.buffer.length,
              dominantClr,
              isCurrent: true,
            },
          }),
          prisma.media.update({
            where: { id: current.id },
            data: {
              url: targetUrl,
              storageKey: uploaded.key,
              mimeType: optimized.mimeType,
              width: optimized.width,
              height: optimized.height,
              fileSizeBytes: optimized.buffer.length,
              dominantClr,
              originalFilename:
                replacement?.filename ?? current.originalFilename,
            },
          }),
          ...postUpdates.map((post) =>
            prisma.post.update({
              where: { id: post.id },
              data: { content: post.content! },
            }),
          ),
        ])
      } catch (error) {
        await deleteFromS3(uploaded.key).catch(() => undefined)
        throw error
      }

      const updated = await prisma.media.findUniqueOrThrow({
        where: { id: current.id },
      })
      await writeAuditLog(context, "media.transform", "Media", current.id, {
        previousUrl: current.url,
        url: updated.url,
        size: optimized.buffer.length,
      })
      return reply.send(serializeMedia(updated))
    },
  )

  secured.delete(
    "/blog/media/:id",
    {
      schema: {
        tags: ["Media"],
        summary: "Delete unused media and all its versions",
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const context = await requireMediaEditor(request, true)
      const media = await prisma.media.findUnique({
        where: { id: request.params.id },
        include: { versions: true },
      })
      if (!media) throw new NotFoundError("Mídia não encontrada.")
      const usages = await findMediaUsages(media.id, [
        media.url,
        ...media.versions.map((version) => version.url),
      ])
      if (usages.length > 0) {
        throw new ConflictError(
          "A mídia está em uso e não pode ser excluída.",
          { usages },
        )
      }
      await prisma.media.delete({ where: { id: media.id } })
      const keys = [
        media.storageKey,
        ...media.versions.map((version) => version.storageKey),
      ].filter((key): key is string => Boolean(key))
      const failures: string[] = []
      for (const key of [...new Set(keys)]) {
        try {
          await deleteFromS3(key)
        } catch {
          failures.push(key)
        }
      }
      await writeAuditLog(context, "media.delete", "Media", media.id, {
        source: media.source,
        storageKeys: keys,
        storageDeleteFailures: failures,
      })
      return reply.code(204).send()
    },
  )
}
