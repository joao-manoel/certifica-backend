import type { Prisma } from "@prisma/client"

import { getMediaDeliveryUrl } from "@/http/routes/blog/media/media-url"
import { prisma } from "@/lib/prisma"
import { getPublicS3Url } from "@/lib/s3"

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
  })

  const replacements = new Map<string, string>()

  for (const item of media) {
    if (!item.storageKey) continue

    const deliveryUrl = getMediaDeliveryUrl(item.id)
    replacements.set(item.url, deliveryUrl)
    replacements.set(getPublicS3Url(item.storageKey), deliveryUrl)

    if (item.url !== deliveryUrl) {
      await prisma.media.update({
        where: { id: item.id },
        data: { url: deliveryUrl },
      })
    }
  }

  const posts = await prisma.post.findMany({
    select: {
      id: true,
      content: true,
    },
  })

  let updatedPosts = 0

  for (const post of posts) {
    const original = JSON.stringify(post.content)
    let migrated = original

    for (const [currentUrl, deliveryUrl] of replacements) {
      migrated = migrated.replaceAll(currentUrl, deliveryUrl)
    }

    if (migrated !== original) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          content: JSON.parse(migrated) as Prisma.InputJsonValue,
        },
      })
      updatedPosts += 1
    }
  }

  console.log(
    `Migração concluída: ${media.length} mídia(s) S3 e ${updatedPosts} post(s) atualizado(s).`,
  )
}

main()
  .catch((error) => {
    console.error("Falha ao migrar URLs das mídias S3.", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
