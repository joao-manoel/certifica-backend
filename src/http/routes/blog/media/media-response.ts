import type { Media } from "@prisma/client"
import { z } from "zod"

export const mediaResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  source: z.enum(["EXTERNAL", "S3"]),
  storageKey: z.string().nullable(),
  title: z.string().nullable(),
  alt: z.string().nullable(),
  caption: z.string().nullable(),
  credit: z.string().nullable(),
  originalFilename: z.string().nullable(),
  fileSizeBytes: z.number().int().nullable(),
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
    source: media.source,
    storageKey: media.storageKey,
    title: media.title,
    alt: media.alt,
    caption: media.caption,
    credit: media.credit,
    originalFilename: media.originalFilename,
    fileSizeBytes: media.fileSizeBytes,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
    dominantClr: media.dominantClr,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
  }
}
