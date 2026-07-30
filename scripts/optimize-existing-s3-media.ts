import type { Prisma } from "@prisma/client"
import sharp from "sharp"

import { getMediaPublicUrl } from "@/http/routes/blog/media/media-url"
import { optimizeBlogImage } from "@/lib/optimize-blog-image"
import { prisma } from "@/lib/prisma"
import {
  deleteFromS3,
  getObjectBuffer,
  getObjectSize,
  getPublicS3Url,
  uploadToS3,
} from "@/lib/s3"

const TARGET_FILE_SIZE = 950_000
const CACHE_CONTROL = "public, max-age=31536000, immutable"
const applyChanges = process.argv.includes("--apply")
const invalidArguments = process.argv
  .slice(2)
  .filter((item) => item !== "--apply")

if (invalidArguments.length > 0) {
  throw new Error(
    `Argumento(s) não suportado(s): ${invalidArguments.join(", ")}`,
  )
}

function replaceJsonUrls(
  content: Prisma.JsonValue,
  replacements: string[],
  targetUrl: string,
) {
  const original = JSON.stringify(content)
  let migrated = original

  for (const currentUrl of replacements) {
    if (currentUrl !== targetUrl) {
      migrated = migrated.replaceAll(currentUrl, targetUrl)
    }
  }

  return migrated === original
    ? null
    : (JSON.parse(migrated) as Prisma.InputJsonValue)
}

async function main() {
  const media = await prisma.media.findMany({
    where: {
      source: "S3",
      storageKey: { not: null },
    },
    select: {
      id: true,
      url: true,
      storageKey: true,
    },
    orderBy: { id: "asc" },
  })

  const candidates: Array<{
    id: string
    storageKey: string
    size: number
  }> = []
  const invalidMedia: Array<{ id: string; reason: string }> = []

  for (const item of media) {
    if (!item.storageKey) continue

    try {
      const size = await getObjectSize(item.storageKey)
      if (size > TARGET_FILE_SIZE) {
        candidates.push({ id: item.id, storageKey: item.storageKey, size })
      }
    } catch (error) {
      invalidMedia.push({
        id: item.id,
        reason: error instanceof Error ? error.message : "Falha desconhecida",
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? "apply" : "dry-run",
        scannedMedia: media.length,
        oversizedMedia: candidates.length,
        oversizedBytes: candidates.reduce(
          (total, item) => total + item.size,
          0,
        ),
        invalidMedia,
      },
      null,
      2,
    ),
  )

  if (!applyChanges) {
    console.log(
      "Nenhuma alteração foi gravada. Use --apply após revisar o dry-run.",
    )
    return
  }

  let optimizedCount = 0
  const posts = await prisma.post.findMany({
    select: { id: true, content: true },
  })

  for (const candidate of candidates) {
    const current = media.find((item) => item.id === candidate.id)
    if (!current?.storageKey) continue

    const input = await getObjectBuffer(current.storageKey)
    const optimized = await optimizeBlogImage(input)
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
        filename: `migration${optimized.extension}`,
        mimetype: optimized.mimeType,
        cacheControl: CACHE_CONTROL,
      },
      "blog/media",
    )
    const targetUrl = getMediaPublicUrl(uploaded.key)
    const replacements = [
      current.url,
      getMediaPublicUrl(current.storageKey),
      getPublicS3Url(current.storageKey),
    ]

    try {
      const postUpdates = posts
        .map((post) => ({
          id: post.id,
          content: replaceJsonUrls(post.content, replacements, targetUrl),
        }))
        .filter(
          (post): post is { id: string; content: Prisma.InputJsonValue } =>
            post.content !== null,
        )

      await prisma.$transaction([
        prisma.media.update({
          where: { id: current.id },
          data: {
            url: targetUrl,
            storageKey: uploaded.key,
            mimeType: optimized.mimeType,
            width: optimized.width,
            height: optimized.height,
            dominantClr,
          },
        }),
        ...postUpdates.map((post) =>
          prisma.post.update({
            where: { id: post.id },
            data: { content: post.content },
          }),
        ),
      ])
    } catch (error) {
      await deleteFromS3(uploaded.key).catch(() => undefined)
      throw error
    }

    optimizedCount += 1
    console.log(
      JSON.stringify({
        mediaId: current.id,
        previousBytes: candidate.size,
        optimizedBytes: optimized.buffer.length,
        targetUrl,
      }),
    )
  }

  console.log(
    `Otimização aplicada a ${optimizedCount} mídia(s). Objetos antigos foram preservados para rollback.`,
  )
}

main()
  .catch((error) => {
    console.error("Falha ao otimizar mídias S3 existentes.", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
