export function guessMimeTypeFromUrl(url: string): string | null {
  const lower = url.split("?")[0].toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".svg")) return "image/svg+xml"
  return null
}

/** normaliza cor dominante para formato `#rrggbb` / `#rrggbbaa` */
export function normalizeHexColor(input?: string | null): string | null {
  if (!input) return null
  let s = input.trim()
  if (!s) return null
  if (!s.startsWith("#")) s = `#${s}`
  // aceita #rgb, #rgba, #rrggbb, #rrggbbaa
  const ok =
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)
  return ok ? s : null
}
