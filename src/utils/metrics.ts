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
