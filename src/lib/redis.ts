import { env } from "@/env"
import Redis from "ioredis"

const url = `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`
if (!url) throw new Error("Missing REDIS_URL")

export const redis = new Redis(url, {
  maxRetriesPerRequest: 2,
  enableAutoPipelining: true,
})
