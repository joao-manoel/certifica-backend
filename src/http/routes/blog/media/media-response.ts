import type { Media } from "@prisma/client"
import { z } from "zod"

export const mediaResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  alt: z.string().nullable(),
  mimeType: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  dominantClr: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export function serializeMedia(media: Media) {
  return {
    id: media.id,
    url: media.url,
    alt: media.alt,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    dominantClr: media.dominantClr,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
  }
}
