import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"
import dotenv from "dotenv"

dotenv.config()

export const env = createEnv({
  server: {
    PORT: z.number().default(3333),
    API_URL: z.string(),
    API_KEY: z.string().min(1),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    JWT_SECRET: z.string().min(1),
    REDIS_HOST: z.string().default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().default(6380),
    NODEMAILER_USER: z.string().min(1),
    NODEMAILER_PASSWORD: z.string().min(1),
  },
  runtimeEnv: {
    PORT: process.env.PORT,
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    FAMILY_STORAGE_PATH: process.env.FAMILY_STORAGE_PATH,
    API_URL: process.env.API_URL,
    API_KEY: process.env.API_KEY,
    NODEMAILER_USER: process.env.NODEMAILER_USER,
    NODEMAILER_PASSWORD: process.env.NODEMAILER_PASSWORD,
  },
})
