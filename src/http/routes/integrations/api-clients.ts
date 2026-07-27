import { createHash, randomBytes } from "node:crypto"

import { Role } from "@prisma/client"
import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { BadRequestError } from "@/http/_errors/bad-request-error"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { apiKey } from "@/http/middlewares/api-key"
import { auth } from "@/http/middlewares/auth"
import { writeAuditLog } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import type { EditorContext } from "@/@types/fastify"

const scopeSchema = z.enum([
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:read",
  "media:write",
])

const apiClientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  scopes: z.array(scopeSchema),
  isActive: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

async function requireDashboardEditor(request: {
  getEditorContext: () => Promise<EditorContext>
}) {
  const context = await request.getEditorContext()
  if (context.kind !== "user") {
    throw new UnauthorizedError(
      "Tokens de integração não podem gerenciar outros tokens.",
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: { id: true, role: true },
  })
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.EDITOR)) {
    throw new UnauthorizedError(
      "Apenas administradores e editores podem gerenciar integrações.",
    )
  }

  return { context, user }
}

function serializeApiClient(client: {
  id: string
  name: string
  scopes: string[]
  isActive: boolean
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}) {
  return {
    ...client,
    scopes: client.scopes as z.infer<typeof scopeSchema>[],
    expiresAt: client.expiresAt?.toISOString() ?? null,
    lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
    createdAt: client.createdAt.toISOString(),
  }
}

export async function apiClients(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(apiKey)
    .register(auth)
    .get(
      "/integrations/api-clients",
      {
        schema: {
          tags: ["Integrations"],
          summary: "List API clients owned by the authenticated user",
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({ items: z.array(apiClientSchema) }),
          },
        },
      },
      async (request, reply) => {
        const { user } = await requireDashboardEditor(request)
        const clients = await prisma.apiClient.findMany({
          where: { authorId: user.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            scopes: true,
            isActive: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
        })

        return reply.send({ items: clients.map(serializeApiClient) })
      },
    )
    .post(
      "/integrations/api-clients",
      {
        schema: {
          tags: ["Integrations"],
          summary: "Create an API client for the authenticated user",
          security: [{ bearerAuth: [] }],
          body: z.object({
            name: z.string().trim().min(3).max(80),
            scopes: z.array(scopeSchema).min(1).max(5),
            expiresInDays: z
              .union([
                z.literal(30),
                z.literal(90),
                z.literal(180),
                z.literal(365),
              ])
              .nullable()
              .default(90),
          }),
          response: {
            201: apiClientSchema.extend({
              token: z.string().startsWith("certifica_"),
            }),
          },
        },
      },
      async (request, reply) => {
        const { context, user } = await requireDashboardEditor(request)
        const activeClients = await prisma.apiClient.count({
          where: {
            authorId: user.id,
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        })
        if (activeClients >= 10) {
          throw new BadRequestError(
            "Você atingiu o limite de 10 tokens ativos. Revogue um token antes de criar outro.",
          )
        }

        const scopes = Array.from(new Set(request.body.scopes))
        const token = `certifica_${randomBytes(32).toString("base64url")}`
        const tokenHash = createHash("sha256").update(token).digest("hex")
        const expiresAt =
          request.body.expiresInDays === null
            ? null
            : new Date(
                Date.now() + request.body.expiresInDays * 24 * 60 * 60 * 1000,
              )

        const created = await prisma.apiClient.create({
          data: {
            name: request.body.name,
            authorId: user.id,
            tokenHash,
            scopes,
            expiresAt,
          },
          select: {
            id: true,
            name: true,
            scopes: true,
            isActive: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
          },
        })
        await writeAuditLog(
          context,
          "api-client.create",
          "ApiClient",
          created.id,
          {
            name: created.name,
            scopes,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
        )

        return reply.code(201).send({
          ...serializeApiClient(created),
          token,
        })
      },
    )
    .delete(
      "/integrations/api-clients/:id",
      {
        schema: {
          tags: ["Integrations"],
          summary: "Revoke an API client owned by the authenticated user",
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.string().uuid() }),
          response: {
            200: z.object({ success: z.literal(true) }),
          },
        },
      },
      async (request, reply) => {
        const { context, user } = await requireDashboardEditor(request)
        const client = await prisma.apiClient.findFirst({
          where: { id: request.params.id, authorId: user.id },
          select: { id: true, name: true, isActive: true },
        })
        if (!client) {
          throw new BadRequestError("Token de integração não encontrado.")
        }

        if (client.isActive) {
          await prisma.apiClient.update({
            where: { id: client.id },
            data: { isActive: false },
          })
          await writeAuditLog(
            context,
            "api-client.revoke",
            "ApiClient",
            client.id,
            { name: client.name },
          )
        }

        return reply.send({ success: true })
      },
    )
}
