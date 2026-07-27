import { createHash } from "node:crypto"

import { BadRequestError } from "@/http/_errors/bad-request-error"
import { prisma } from "@/lib/prisma"

export function hashPayload(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export async function findIdempotentResponse(
  apiClientId: string | null,
  key: string | undefined,
  operation: string,
  requestHash: string,
) {
  if (!apiClientId || !key) return null
  const existing = await prisma.idempotencyRecord.findUnique({
    where: {
      apiClientId_key_operation: { apiClientId, key, operation },
    },
  })
  if (!existing) return null
  if (existing.requestHash !== requestHash) {
    throw new BadRequestError(
      "Idempotency-Key já utilizada com outro conteúdo.",
    )
  }
  return { statusCode: existing.statusCode, response: existing.response }
}

export async function saveIdempotentResponse(input: {
  apiClientId: string | null
  key?: string
  operation: string
  requestHash: string
  statusCode: number
  response: object
}) {
  if (!input.apiClientId || !input.key) return
  await prisma.idempotencyRecord.create({
    data: {
      apiClientId: input.apiClientId,
      key: input.key,
      operation: input.operation,
      requestHash: input.requestHash,
      statusCode: input.statusCode,
      response: input.response,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })
}
