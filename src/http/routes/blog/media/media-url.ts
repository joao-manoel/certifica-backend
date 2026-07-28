import { env } from "@/env"

export function getMediaDeliveryUrl(id: string) {
  const apiUrl = env.API_URL.replace(/\/+$/, "")
  return `${apiUrl}/blog/media/${id}/file`
}
