// src/http/get-dashboard-metrics.ts
import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, ViewStatus } from "@prisma/client"

/**
 * Limites de mês (UTC). Se precisar em timezone específico,
 * troque por uma lib (ex: date-fns-tz) e aplique o tz desejado.
 */
function getMonthBoundaries(date = new Date()) {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() // 0..11

  const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0))
  const nextMonthStart = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0))

  const prevMonthStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0))
  const prevMonthEnd = monthStart // exclusivo

  return { monthStart, nextMonthStart, prevMonthStart, prevMonthEnd }
}

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) {
    if (curr === 0) return 0
    return 100 // por convenção: de 0 -> algo = +100%
  }
  return ((curr - prev) / prev) * 100
}

export async function getMetrics(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/metrics",
      {
        schema: {
          tags: ["Metrics"],
          summary: "Métricas consolidadas para o dashboard",
          response: {
            200: z.object({
              totalPublished: z.number().int().nonnegative(),

              monthlyPublished: z.object({
                value: z.number().int().nonnegative(),
                prev: z.number().int().nonnegative(),
                momDeltaPct: z.number(), // pode ser negativo
              }),

              monthlyViews: z.object({
                value: z.number().int().nonnegative(),
                prev: z.number().int().nonnegative(),
                momDeltaPct: z.number(),
              }),

              // Alias pronto para o card "Taxa de Crescimento"
              // (por padrão, baseado em views mês a mês)
              growthRateMonthly: z.number(),
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
            "Você não tem permissão para consultar métricas.",
          )
        }

        const { monthStart, nextMonthStart, prevMonthStart, prevMonthEnd } =
          getMonthBoundaries(new Date())

        // Tudo numa transação para consistência e uma ida ao DB
        const [
          totalPublished,
          publishedThisMonth,
          publishedPrevMonth,
          viewsThisMonth,
          viewsPrevMonth,
        ] = await prisma.$transaction([
          prisma.post.count({
            where: { status: PostStatus.PUBLISHED },
          }),
          prisma.post.count({
            where: {
              status: PostStatus.PUBLISHED,
              publishedAt: { gte: monthStart, lt: nextMonthStart },
            },
          }),
          prisma.post.count({
            where: {
              status: PostStatus.PUBLISHED,
              publishedAt: { gte: prevMonthStart, lt: prevMonthEnd },
            },
          }),
          prisma.postView.count({
            where: {
              status: ViewStatus.APPLIED,
              createdAt: { gte: monthStart, lt: nextMonthStart },
            },
          }),
          prisma.postView.count({
            where: {
              status: ViewStatus.APPLIED,
              createdAt: { gte: prevMonthStart, lt: prevMonthEnd },
            },
          }),
        ])

        const publishedMoM = pctDelta(publishedThisMonth, publishedPrevMonth)
        const viewsMoM = pctDelta(viewsThisMonth, viewsPrevMonth)

        // Se preferir que growth seja baseado em posts publicados:
        // const growthRateMonthly = publishedMoM;
        const growthRateMonthly = viewsMoM

        return reply.send({
          totalPublished,
          monthlyPublished: {
            value: publishedThisMonth,
            prev: publishedPrevMonth,
            momDeltaPct: Number(publishedMoM.toFixed(2)),
          },
          monthlyViews: {
            value: viewsThisMonth,
            prev: viewsPrevMonth,
            momDeltaPct: Number(viewsMoM.toFixed(2)),
          },
          growthRateMonthly: Number(growthRateMonthly.toFixed(2)),
        })
      },
    )
}
