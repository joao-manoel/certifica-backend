import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { slugify } from "@/utils/blog-utils"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import type { Prisma } from "@prisma/client"

export async function listUtmEvents(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/analytics/utm/utm-events",
    {
      schema: {
        tags: ["Analytics"],
        summary:
          "Lista eventos UTM (opcionalmente filtrando por sourceName/campaignName) ou retorna apenas o count",
        querystring: z.object({
          sourceName: z.string().trim().min(1).optional(),
          campaignName: z.string().trim().min(1).optional(),
          page: z.coerce.number().int().positive().default(1),
          perPage: z.coerce.number().int().min(1).max(100).default(20),
          countOnly: z
            .union([z.literal("true"), z.literal("false")])
            .default("false")
            .transform((v) => v === "true"),
        }),
        response: {
          200: z.union([
            z.object({ count: z.number().int().nonnegative() }),
            z.object({
              page: z.number(),
              perPage: z.number(),
              total: z.number(),
              items: z.array(
                z.object({
                  id: z.string().uuid(),
                  sourceId: z.string().uuid(),
                  mediumId: z.string().uuid(),
                  campaignId: z.string().uuid(),
                  source: z.string().nullable(),
                  medium: z.string().nullable(),
                  campaign: z.string().nullable(),
                  referrer: z.string().nullable(),
                  landingUrl: z.string().nullable(),
                  device: z.string().nullable(),
                  browser: z.string().nullable(),
                  os: z.string().nullable(),
                  country: z.string().nullable(),
                  capturedAt: z.string().datetime(),
                }),
              ),
            }),
          ]),
        },
      },
    },
    async (request, reply) => {
      const { sourceName, campaignName, page, perPage, countOnly } =
        request.query

      let sourceId: string | undefined
      let campaignId: string | undefined

      // Resolve nomes -> IDs via slug (caso fornecidos)
      if (sourceName) {
        const src = await prisma.utmSource.findUnique({
          where: { slug: slugify(sourceName) },
          select: { id: true },
        })
        if (!src) throw new BadRequestError("Source não encontrada.")
        sourceId = src.id
      }

      if (campaignName) {
        const camp = await prisma.utmCampaign.findUnique({
          where: { slug: slugify(campaignName) },
          select: { id: true },
        })
        if (!camp) throw new BadRequestError("Campaign não encontrada.")
        campaignId = camp.id
      }

      // Monta o filtro dinamicamente
      let where: Prisma.UtmEventWhereInput = {}
      if (sourceId && campaignId)
        where = { AND: [{ sourceId }, { campaignId }] }
      else if (sourceId) where = { sourceId }
      else if (campaignId) where = { campaignId }

      // Count apenas
      if (countOnly) {
        const count = await prisma.utmEvent.count({ where })
        return reply.code(200).send({ count })
      }

      const total = await prisma.utmEvent.count({ where })

      const items = await prisma.utmEvent.findMany({
        where,
        orderBy: { capturedAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          sourceId: true,
          mediumId: true,
          campaignId: true,
          source: true,
          medium: true,
          campaign: true,
          referrer: true,
          landingUrl: true,
          device: true,
          browser: true,
          os: true,
          country: true,
          capturedAt: true,
        },
      })

      return reply.code(200).send({
        page,
        perPage,
        total,
        items: items.map((i) => ({
          id: i.id,
          sourceId: i.sourceId as string,
          mediumId: i.mediumId as string,
          campaignId: i.campaignId as string,
          source: i.source ?? null,
          medium: i.medium ?? null,
          campaign: i.campaign ?? null,
          referrer: i.referrer ?? null,
          landingUrl: i.landingUrl ?? null,
          device: i.device ?? null,
          browser: i.browser ?? null,
          os: i.os ?? null,
          country: i.country ?? null,
          capturedAt:
            i.capturedAt instanceof Date
              ? i.capturedAt.toISOString()
              : new Date(i.capturedAt as unknown as string).toISOString(),
        })),
      })
    },
  )
}
