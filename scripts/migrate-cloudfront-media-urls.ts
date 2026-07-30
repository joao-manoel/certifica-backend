import type { Prisma } from "@prisma/client"

import {
  getMediaDeliveryUrl,
  getMediaPublicUrl,
} from "@/http/routes/blog/media/media-url"
import { prisma } from "@/lib/prisma"
import { getPublicS3Url } from "@/lib/s3"

const applyChanges = process.argv.includes("--apply")
const invalidArguments = process.argv
  .slice(2)
  .filter((item) => item !== "--apply")

if (invalidArguments.length > 0) {
  throw new Error(
    `Argumento(s) não suportado(s): ${invalidArguments.join(", ")}`,
  )
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

  const replacements = new Map<string, string>()
  const mediaUpdates: Array<{ id: string; url: string }> = []
  const invalidMedia: string[] = []

  for (const item of media) {
    if (!item.storageKey) {
      invalidMedia.push(item.id)
      continue
    }

    let publicUrl: string
    try {
      publicUrl = getMediaPublicUrl(item.storageKey)
    } catch {
      invalidMedia.push(item.id)
      continue
    }

    const previousUrls = [
      item.url,
      getMediaDeliveryUrl(item.id),
      getPublicS3Url(item.storageKey),
    ]

    for (const previousUrl of previousUrls) {
      if (previousUrl !== publicUrl) replacements.set(previousUrl, publicUrl)
    }

    if (item.url !== publicUrl) {
      mediaUpdates.push({ id: item.id, url: publicUrl })
    }
  }

  const posts = await prisma.post.findMany({
    select: {
      id: true,
      content: true,
    },
    orderBy: { id: "asc" },
  })

  const postUpdates: Array<{
    id: string
    content: Prisma.InputJsonValue
  }> = []

  for (const post of posts) {
    const original = JSON.stringify(post.content)
    let migrated = original

    for (const [currentUrl, publicUrl] of replacements) {
      migrated = migrated.replaceAll(currentUrl, publicUrl)
    }

    if (migrated !== original) {
      postUpdates.push({
        id: post.id,
        content: JSON.parse(migrated) as Prisma.InputJsonValue,
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? "apply" : "dry-run",
        scannedMedia: media.length,
        mediaToUpdate: mediaUpdates.length,
        scannedPosts: posts.length,
        postsToUpdate: postUpdates.length,
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

  await prisma.$transaction([
    ...mediaUpdates.map((item) =>
      prisma.media.update({
        where: { id: item.id },
        data: { url: item.url },
      }),
    ),
    ...postUpdates.map((item) =>
      prisma.post.update({
        where: { id: item.id },
        data: { content: item.content },
      }),
    ),
  ])

  console.log(
    `Migração aplicada: ${mediaUpdates.length} mídia(s) e ${postUpdates.length} post(s) atualizado(s).`,
  )
}

main()
  .catch((error) => {
    console.error("Falha ao migrar URLs de mídia para o CloudFront.", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
