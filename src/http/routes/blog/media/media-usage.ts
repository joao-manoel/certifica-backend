import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type MediaUsage = {
  id: string
  title: string
  slug: string
  kind: "cover" | "body"
}

export async function findMediaUsages(
  mediaId: string,
  urls: string[],
): Promise<MediaUsage[]> {
  const posts = await prisma.post.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
      coverId: true,
      content: true,
    },
    orderBy: { updatedAt: "desc" },
  })
  const uniqueUrls = [...new Set(urls.filter(Boolean))]
  const usages: MediaUsage[] = []

  for (const post of posts) {
    if (post.coverId === mediaId) {
      usages.push({
        id: post.id,
        title: post.title,
        slug: post.slug,
        kind: "cover",
      })
    }

    const content = JSON.stringify(post.content)
    if (uniqueUrls.some((url) => content.includes(url))) {
      usages.push({
        id: post.id,
        title: post.title,
        slug: post.slug,
        kind: "body",
      })
    }
  }

  return usages
}

export function replaceMediaUrls(
  content: Prisma.JsonValue,
  urls: string[],
  targetUrl: string,
) {
  const original = JSON.stringify(content)
  let updated = original
  for (const url of [...new Set(urls.filter(Boolean))]) {
    if (url !== targetUrl) updated = updated.replaceAll(url, targetUrl)
  }
  return updated === original
    ? null
    : (JSON.parse(updated) as Prisma.InputJsonValue)
}
