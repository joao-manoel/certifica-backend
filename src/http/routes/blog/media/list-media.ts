import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { auth } from "@/http/middlewares/auth"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { Role } from "@prisma/client"

const ORDER_FIELDS = ["createdAt", "updatedAt"] as const
type OrderField = (typeof ORDER_FIELDS)[number]

export async function listMedia(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/media",
      {
        schema: {
          tags: ["Media"],
          summary: "List media (paginated)",
          querystring: z.object({
            page: z.coerce.number().int().min(1).default(1),
            perPage: z.coerce.number().int().min(1).max(100).default(20),
            q: z.string().trim().min(1).max(200).optional(), // busca em url/alt/mimeType
            mimeType: z.string().trim().max(100).optional(),
            orderBy: z
              .enum(
                new Set(ORDER_FIELDS) as unknown as [
                  OrderField,
                  ...OrderField[],
                ],
              )
              .default("createdAt"),
            sort: z.enum(["asc", "desc"]).default("desc"),
            ids: z.array(z.string().uuid()).optional(),
          }),
          response: {
            200: z.object({
              meta: z.object({
                page: z.number().int(),
                perPage: z.number().int(),
                total: z.number().int(),
                totalPages: z.number().int(),
              }),
              items: z.array(
                z.object({
                  id: z.string().uuid(),
                  url: z.string().url(),
                  alt: z.string().nullable(),
                  mimeType: z.string().nullable(),
                  width: z.number().int().nullable(),
                  height: z.number().int().nullable(),
                  dominantClr: z.string().nullable(),
                  createdAt: z.string().datetime(),
                  updatedAt: z.string().datetime(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true },
        })

        if (!user) throw new UnauthorizedError("Usuário não autenticado.")
        if (user.role !== Role.ADMIN && user.role !== Role.EDITOR) {
          throw new UnauthorizedError(
            "Você não tem permissão para listar mídia.",
          )
        }

        const { page, perPage, q, mimeType, orderBy, sort, ids } = request.query

        const where = {
          AND: [
            ids && ids.length > 0 ? { id: { in: ids } } : undefined,
            mimeType ? { mimeType: { equals: mimeType } } : undefined,
            q
              ? {
                  OR: [
                    { url: { contains: q, mode: "insensitive" as const } },
                    { alt: { contains: q, mode: "insensitive" as const } },
                    { mimeType: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : undefined,
          ].filter(Boolean) as any[],
        }

        const [total, rows] = await Promise.all([
          prisma.media.count({ where }),
          prisma.media.findMany({
            where,
            orderBy: { [orderBy]: sort },
            skip: (page - 1) * perPage,
            take: perPage,
            select: {
              id: true,
              url: true,
              alt: true,
              mimeType: true,
              width: true,
              height: true,
              dominantClr: true,
              createdAt: true,
              updatedAt: true,
            },
          }),
        ])

        const items = rows.map((m) => ({
          id: m.id,
          url: m.url,
          alt: m.alt,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          dominantClr: m.dominantClr,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        }))

        const totalPages = Math.max(1, Math.ceil(total / perPage))

        return reply.send({
          meta: { page, perPage, total, totalPages },
          items,
        })
      },
    )
}
