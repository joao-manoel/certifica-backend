import type { FastifyInstance } from "fastify"
import { fastifyPlugin } from "fastify-plugin"
import { createHash } from "node:crypto"

import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { prisma } from "@/lib/prisma"
import type { EditorContext, EditorScope } from "@/@types/fastify"

const USER_SCOPES: EditorScope[] = [
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:read",
  "media:write",
]

function getBearerToken(authorization?: string) {
  const [scheme, token] = authorization?.split(" ") ?? []
  return scheme?.toLowerCase() === "bearer" && token ? token : null
}

export const auth = fastifyPlugin(async (app: FastifyInstance) => {
  app.addHook("preHandler", async (request) => {
    let cachedContext: EditorContext | undefined

    request.getEditorContext = async () => {
      if (cachedContext) return cachedContext

      const token = getBearerToken(request.headers.authorization)
      if (!token) throw new UnauthorizedError("Token obrigatório.")

      try {
        const { sub, sessionVersion } = await request.jwtVerify<{
          sub: string
          sessionVersion?: number
        }>()
        const user = await prisma.user.findUnique({
          where: { id: sub },
          select: { isActive: true, sessionVersion: true },
        })
        if (
          !user ||
          !user.isActive ||
          sessionVersion !== user.sessionVersion
        ) {
          throw new UnauthorizedError("Sessão inválida ou expirada.")
        }
        cachedContext = {
          userId: sub,
          apiClientId: null,
          scopes: USER_SCOPES,
          kind: "user",
        }
        return cachedContext
      } catch {}

      const tokenHash = createHash("sha256").update(token).digest("hex")
      const client = await prisma.apiClient.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          authorId: true,
          scopes: true,
          isActive: true,
          expiresAt: true,
        },
      })

      if (
        !client ||
        !client.isActive ||
        (client.expiresAt && client.expiresAt <= new Date())
      ) {
        throw new UnauthorizedError("Token de integração inválido ou expirado.")
      }

      await prisma.apiClient.update({
        where: { id: client.id },
        data: { lastUsedAt: new Date() },
      })

      cachedContext = {
        userId: client.authorId,
        apiClientId: client.id,
        scopes: client.scopes as EditorScope[],
        kind: "integration",
      }
      return cachedContext
    }

    request.requireScopes = async (scopes) => {
      const context = await request.getEditorContext()
      const missing = scopes.filter((scope) => !context.scopes.includes(scope))
      if (missing.length > 0) {
        throw new UnauthorizedError(
          `Permissão insuficiente. Scopes ausentes: ${missing.join(", ")}.`,
        )
      }
      return context
    }

    request.getCurrentUserId = async () => {
      const context = await request.getEditorContext()
      return context.userId
    }
  })
})
