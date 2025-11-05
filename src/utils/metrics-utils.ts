// src/utils/metrics.ts
import crypto from "crypto"

const PEPPER = process.env.VIEW_IP_PEPPER ?? "change_me"

export function yyyymmdd(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

export function truncateIp(ip: string) {
  // 1) IPv4: 1.2.3.x
  if (ip.includes(".")) {
    const parts = ip.split(".")
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`
  }
  // 2) IPv6: encurta p/ /64 (metade)
  if (ip.includes(":")) {
    const segs = ip.split(":")
    return segs.slice(0, 4).join(":") + "::"
  }
  return "0.0.0.0"
}

export function hashIp(ip: string) {
  const h = crypto.createHash("sha256")
  h.update(`${truncateIp(ip)}::${PEPPER}`)
  return h.digest("hex")
}

export function isBotUA(ua?: string) {
  const s = (ua ?? "").toLowerCase()
  if (!s) return false
  return (
    s.includes("bot") ||
    s.includes("spider") ||
    s.includes("crawler") ||
    s.includes("preview") ||
    s.includes("fetch") ||
    s.includes("headless") ||
    s.includes("monitor") ||
    s.includes("pingdom")
  )
}

export function parseClientHints(ua?: string) {
  const s = (ua ?? "").toLowerCase()
  const device = s.includes("mobile")
    ? "mobile"
    : s.includes("tablet")
      ? "tablet"
      : "desktop"
  const browser = s.includes("chrome")
    ? "chrome"
    : s.includes("safari")
      ? "safari"
      : s.includes("firefox")
        ? "firefox"
        : s.includes("edge")
          ? "edge"
          : undefined
  const os = s.includes("windows")
    ? "windows"
    : s.includes("mac os") || s.includes("macos")
      ? "macos"
      : s.includes("android")
        ? "android"
        : s.includes("linux")
          ? "linux"
          : s.includes("ios")
            ? "ios"
            : undefined

  return { device, browser, os }
}

export function isBot(ua: string | undefined) {
  const s = (ua ?? "").toLowerCase()
  if (!s) return false
  return (
    s.includes("bot") ||
    s.includes("spider") ||
    s.includes("crawler") ||
    s.includes("preview") ||
    s.includes("fetch") ||
    s.includes("monitoring") ||
    s.includes("headless") ||
    s.includes("pingdom")
  )
}

/** Limites de mês (UTC). Ajuste para tz local se precisar. */
export function getMonthBoundaries(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
  const nextMonthStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))
  const prevMonthStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const prevMonthEnd = monthStart
  return { monthStart, nextMonthStart, prevMonthStart, prevMonthEnd }
}

/** yyyyMMdd (UTC) */
export function yyyymmddUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const day = d.getUTCDate().toString().padStart(2, "0")
  return `${y}${m}${day}`
}

/** últimos 30 dias (hoje incluso), em UTC */
export function last30DaysUTC(today = new Date()) {
  const days: string[] = []
  const base = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  )
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() - i)
    days.push(yyyymmddUTC(d))
  }
  // janelas para createdAt
  const start = new Date(base)
  start.setUTCDate(base.getUTCDate() - 29) // 30 dias atrás 00:00 UTC
  const end = new Date(base)
  end.setUTCDate(base.getUTCDate() + 1) // amanhã 00:00 UTC (exclusivo)
  return { days, start, end }
}

export function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100
  return ((curr - prev) / prev) * 100
}
