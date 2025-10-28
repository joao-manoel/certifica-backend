import { env } from "@/env"
import type { FastifyInstance } from "fastify"
import { fastifyPlugin } from "fastify-plugin"
import { UnauthorizedError } from "../_errors/unauthorized-error"

export const apiKey = fastifyPlugin(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (request) => {
    const apiKey = request.headers["x-api-key"]

    if (apiKey !== env.API_KEY) {
      throw new UnauthorizedError("Invalid api key")
    }
  })
})
