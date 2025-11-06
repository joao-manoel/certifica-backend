import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { s3 } from "@/lib/s3"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/env"

function fallbackMimeFromFilename(name?: string) {
  if (!name) return undefined
  const n = name.toLowerCase()
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg"
  if (n.endsWith(".webp")) return "image/webp"
  if (n.endsWith(".avif")) return "image/avif"
  return undefined
}

function stripImageExt(s: string) {
  return s.replace(/\.(png|jpe?g|webp|avif)$/i, "")
}

export async function getUserAvatarByUsername(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/users/avatar/:username",
    {
      schema: {
        tags: ["Users"],
        summary: "Stream do avatar com username amigável",
        security: [{ bearerAuth: [] }],
        params: z.object({ username: z.string() }),
        querystring: z.object({ v: z.string().optional() }),
      },
    },
    async (request, reply) => {
      let { username } = request.params as { username: string }
      if (!username)
        return reply.code(400).send({ message: "Username is required" })

      // Suporte a /users/avatar/<username>.<ext>
      const requested = username
      const requestedExt = (
        requested.match(/\.(png|jpe?g|webp|avif)$/i)?.[1] ?? ""
      ).toLowerCase()
      username = stripImageExt(username)

      const user = await prisma.user.findUnique({
        where: { username },
        select: { avatarKey: true, avatarMime: true, avatarUpdatedAt: true },
      })
      if (!user) return reply.code(404).send({ message: "User not found" })
      if (!user.avatarKey) return reply.code(204).send()

      const result = await s3.send(
        new GetObjectCommand({
          Bucket: env.S3_BUCKET_NAME!,
          Key: user.avatarKey,
        }),
      )
      if (!result.Body) return reply.code(204).send()

      // ==== Cache condicional (ETag / Last-Modified) ====
      const lastModDate =
        user.avatarUpdatedAt ??
        (result.LastModified instanceof Date
          ? result.LastModified
          : undefined) ??
        new Date()
      const lastModified = lastModDate.toUTCString()
      const etag = (result.ETag || "").replace(/"/g, "")

      const inm = request.headers["if-none-match"]
      if (etag && typeof inm === "string" && inm === etag) {
        reply.header("ETag", etag)
        reply.header("Last-Modified", lastModified)
        reply.header("Cache-Control", "private, no-cache, must-revalidate")
        return reply.code(304).send()
      }

      const ims = request.headers["if-modified-since"]
      if (typeof ims === "string") {
        const imsDate = new Date(ims)
        if (!isNaN(imsDate.getTime()) && lastModDate <= imsDate) {
          reply.header("ETag", etag)
          reply.header("Last-Modified", lastModified)
          reply.header("Cache-Control", "private, no-cache, must-revalidate")
          return reply.code(304).send()
        }
      }

      // ==== Content-Type e filename amigável ====
      // prioridade: mime do banco > do S3 > pela extensão da URL > octet-stream
      const contentType =
        user.avatarMime ||
        result.ContentType ||
        (requestedExt
          ? fallbackMimeFromFilename("." + requestedExt)
          : undefined) ||
        fallbackMimeFromFilename(requested) ||
        "application/octet-stream"

      reply.header("Content-Type", contentType)
      reply.header("ETag", etag)
      reply.header("Last-Modified", lastModified)
      reply.header("Cache-Control", "private, no-cache, must-revalidate")

      // Se o cliente pediu /username.jpg, mantenha esse nome; senão, derive pelo mime
      let filename = requested
      if (!/\.(png|jpe?g|webp|avif)$/i.test(filename)) {
        const extFromMime =
          contentType === "image/png"
            ? "png"
            : contentType === "image/webp"
              ? "webp"
              : contentType === "image/avif"
                ? "avif"
                : "jpg" // default “amigável”
        filename = `${username}.${extFromMime}`
      }
      reply.header("Content-Disposition", `inline; filename="${filename}"`)

      return reply.send(result.Body as any)
    },
  )
}
