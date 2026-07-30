import { env } from "@/env"

const MEDIA_STORAGE_PREFIX = "blog/media/"

export function getMediaDeliveryUrl(id: string) {
  const apiUrl = env.API_URL.replace(/\/+$/, "")
  return `${apiUrl}/blog/media/${id}/file`
}

export function getMediaPublicUrl(storageKey: string) {
  if (
    !storageKey.startsWith(MEDIA_STORAGE_PREFIX) ||
    storageKey.includes("..") ||
    storageKey.includes("\\")
  ) {
    throw new Error("Chave de mídia inválida.")
  }

  const baseUrl = env.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, "")
  const encodedKey = storageKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")

  return `${baseUrl}/${encodedKey}`
}
