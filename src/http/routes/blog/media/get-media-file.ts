import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { NotFoundError } from "@/http/_errors/not-found-error"
import { getMediaPublicUrl } from "@/http/routes/blog/media/media-url"
import { prisma } from "@/lib/prisma"

export async function getMediaFile(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/blog/media/:id/file",
    {
      schema: {
        tags: ["Media"],
        summary: "Redirect a legacy media URL to its public CDN URL",
        params: z.object({
          id: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      const media = await prisma.media.findUnique({
        where: { id: request.params.id },
        select: {
          source: true,
          storageKey: true,
        },
      })

      if (!media || media.source !== "S3" || !media.storageKey) {
        throw new NotFoundError("Mídia não encontrada.")
      }

      const publicUrl = getMediaPublicUrl(media.storageKey)

      return reply
        .header("Cache-Control", "public, max-age=3600")
        .redirect(publicUrl)
    },
  )
}
