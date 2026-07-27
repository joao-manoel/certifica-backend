import type { EditorContext } from "@/@types/fastify"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"

export async function writeAuditLog(
  context: EditorContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      apiClientId: context.apiClientId,
      userId: context.userId,
      action,
      resourceType,
      resourceId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  })
}
