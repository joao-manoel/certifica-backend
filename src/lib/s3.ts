// lib/s3.ts
import { env } from "@/env"
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "crypto"
import { extname } from "path"
import type { Readable } from "stream"

export const s3 = new S3Client({
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
})

interface UploadInput {
  buffer: Buffer
  filename: string
  mimetype: string
}

export async function uploadToS3(file: UploadInput, folder: string) {
  const extension = extname(file.filename).toLowerCase()
  const key = `${folder}/${randomUUID()}${extension}`

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME!,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // ACL padrão já é privado – mantenha assim
    }),
  )

  return { key }
}

export async function deleteFromS3(key: string) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.S3_BUCKET_NAME!,
      Key: key,
    }),
  )
}

export async function getSignedGetUrl(key: string, expiresInSeconds = 60) {
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET_NAME!,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds })
}

// helper para acumular stream -> Buffer (Fastify multipart)
export async function streamToBuffer(stream: Readable) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
