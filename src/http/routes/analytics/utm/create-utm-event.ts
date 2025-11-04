import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { slugify } from "@/utils/blog-utils"

export async function createUtmEvent(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/analytics/utm/create-utm-event",
    {
      schema: {
        tags: ["Analytics"],
        summary: "Cria um evento UTM (apenas se dimensões existirem)",
        body: z.object({
          source: z.string().trim().max(100),
          medium: z.string().trim().max(100),
          campaign: z.string().trim().max(150),
          term: z.string().trim().max(150).optional(),
          content: z.string().trim().max(150).optional(),
          referrer: z.string().url().max(300).optional(),
          landingUrl: z.string().url().max(400).optional(),
          device: z.string().trim().max(30).optional(),
          browser: z.string().trim().max(30).optional(),
          os: z.string().trim().max(30).optional(),
          country: z
            .string()
            .length(2)
            .transform((v) => v.toUpperCase())
            .optional(),
        }),
        response: {
          204: z.null(), // No Content
          422: z.object({
            message: z.string(),
            missing: z.array(z.string()),
          }),
        },
      },
    },
    async (request, reply) => {
      const body = request.body

      const referrer =
        body.referrer ??
        (typeof request.headers.referer === "string"
          ? request.headers.referer
          : undefined)

      const srcSlug = slugify(body.source)
      const medSlug = slugify(body.medium)
      const campSlug = slugify(body.campaign)

      // Busca dimensões existentes
      const [src, med, camp] = await Promise.all([
        prisma.utmSource.findUnique({
          where: { slug: srcSlug },
          select: { id: true },
        }),
        prisma.utmMedium.findUnique({
          where: { slug: medSlug },
          select: { id: true },
        }),
        prisma.utmCampaign.findUnique({
          where: { slug: campSlug },
          select: { id: true },
        }),
      ])

      const missing: string[] = []
      if (!src) missing.push("source")
      if (!med) missing.push("medium")
      if (!camp) missing.push("campaign")

      if (missing.length > 0) {
        return reply.code(422).send({
          message: `Dimensões ausentes: ${missing.join(", ")}`,
          missing,
        })
      }

      // Narrow explícito para satisfazer o TS (apesar do 422 acima)
      if (!src || !med || !camp) {
        throw new Error("Dimensões ausentes — checagem lógica inconsistente.")
      }

      // Cria evento; não precisamos do retorno completo
      await prisma.utmEvent.create({
        data: {
          // snapshot raw
          source: body.source,
          medium: body.medium,
          campaign: body.campaign,
          term: body.term ?? null,
          content: body.content ?? null,
          referrer: referrer ?? null,
          landingUrl: body.landingUrl ?? null,
          device: body.device ?? null,
          browser: body.browser ?? null,
          os: body.os ?? null,
          country: body.country ?? null,
          // FKs garantidos
          sourceId: src.id,
          mediumId: med.id,
          campaignId: camp.id,
        },
        select: { id: true },
      })

      return reply.code(204).send(null)
    },
  )
}
