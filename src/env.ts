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
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().min(1),
    S3_BUCKET_NAME: z.string().min(1),
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BASE_URL: z.string().min(1),
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
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BASE_URL: process.env.S3_BASE_URL,
  },
})
