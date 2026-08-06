import { env } from "@/env"
import type { FastifyInstance } from "fastify"
import { fastifyPlugin } from "fastify-plugin"
import { UnauthorizedError } from "../_errors/unauthorized-error"

export const apiKey = fastifyPlugin(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (request) => {
    const authorization = request.headers.authorization
    const [scheme, bearerToken] = authorization?.trim().split(/\s+/, 2) ?? []

    // Rotas que também registram o middleware `auth` aceitam JWT de usuário
    // ou token de integração/MCP. A identidade e os scopes são validados pelo
    // `auth` no preHandler, então não exigimos também a chave global.
    if (scheme?.toLowerCase() === "bearer" && bearerToken) {
      return
    }

    const providedApiKey = request.headers["x-api-key"]

    if (providedApiKey !== env.API_KEY) {
      throw new UnauthorizedError("Invalid api key")
    }
  })
})
