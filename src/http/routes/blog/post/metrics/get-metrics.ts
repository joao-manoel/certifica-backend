import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, ViewStatus } from "@prisma/client"
import {
  getMonthBoundaries,
  last30DaysUTC,
  pctDelta,
} from "@/utils/metrics-utils"

export async function getMetrics(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      "/blog/metrics",
      {
        schema: {
          tags: ["Metrics"],
          summary:
            "Métricas consolidadas para o dashboard (cards + série diária + engajamento + top posts)",
          response: {
            200: z.object({
              totalPublished: z.number().int().nonnegative(),

              monthlyPublished: z.object({
                value: z.number().int().nonnegative(),
                prev: z.number().int().nonnegative(),
                momDeltaPct: z.number(),
              }),

              monthlyViews: z.object({
                value: z.number().int().nonnegative(),
                prev: z.number().int().nonnegative(),
                momDeltaPct: z.number(),
              }),

              growthRateMonthly: z.number(),

              // NOVO: série diária últimos 30 dias
              viewsDaily: z.array(
                z.object({
                  day: z.string(), // yyyyMMdd
                  value: z.number().int().nonnegative(),
                }),
              ),

              // NOVO: engajamento/comportamento
              engagement: z.object({
                devices: z.array(
                  z.object({
                    key: z.string().nullable(),
                    value: z.number().int(),
                  }),
                ),
                browsers: z.array(
                  z.object({
                    key: z.string().nullable(),
                    value: z.number().int(),
                  }),
                ),
                os: z.array(
                  z.object({
                    key: z.string().nullable(),
                    value: z.number().int(),
                  }),
                ),
                countries: z.array(
                  z.object({
                    key: z.string().nullable(),
                    value: z.number().int(),
                  }),
                ),
                referrers: z.array(
                  z.object({
                    key: z.string().nullable(),
                    value: z.number().int(),
                  }),
                ),
              }),

              // NOVO: top posts por views (últimos 30 dias)
              topPosts: z.array(
                z.object({
                  postId: z.string(),
                  title: z.string(),
                  slug: z.string(),
                  views: z.number().int().nonnegative(),
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
            "Você não tem permissão para consultar métricas.",
          )
        }

        const { monthStart, nextMonthStart, prevMonthStart, prevMonthEnd } =
          getMonthBoundaries(new Date())
        const {
          days,
          start: last30Start,
          end: last30End,
        } = last30DaysUTC(new Date())

        // ---- Cards principais (como você já tinha) ----
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
        const growthRateMonthly = viewsMoM // pode trocar por publishedMoM se preferir

        // ---- Views por dia (últimos 30 dias) ----
        // Usamos o campo 'day' (yyyyMMdd) indexado + filtro de janela por createdAt para consistência.
        const byDay = await prisma.postView.groupBy({
          by: ["day"],
          where: {
            status: ViewStatus.APPLIED,
            createdAt: { gte: last30Start, lt: last30End },
          },
          _count: { _all: true },
        })

        const dayToCount = new Map<string, number>()
        for (const row of byDay) {
          dayToCount.set(row.day, row._count._all)
        }
        const viewsDaily = days.map((d) => ({
          day: d,
          value: dayToCount.get(d) ?? 0,
        }))

        // ---- Engajamento (últimos 30 dias) ----
        // Top N por dimensão (pode ajustar o N conforme necessidade)
        const TOP_N = 6

        const [gDevices, gBrowsers, gOS, gCountries, gReferrers] =
          await Promise.all([
            prisma.postView.groupBy({
              by: ["device"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: last30Start, lt: last30End },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["browser"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: last30Start, lt: last30End },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["os"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: last30Start, lt: last30End },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["country"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: last30Start, lt: last30End },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["referrer"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: last30Start, lt: last30End },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
          ])

        const engagement = {
          devices: gDevices.map((r) => ({
            key: r.device ?? null,
            value: r._count._all,
          })),
          browsers: gBrowsers.map((r) => ({
            key: r.browser ?? null,
            value: r._count._all,
          })),
          os: gOS.map((r) => ({ key: r.os ?? null, value: r._count._all })),
          countries: gCountries.map((r) => ({
            key: r.country ?? null,
            value: r._count._all,
          })),
          referrers: gReferrers.map((r) => ({
            key: r.referrer ?? null,
            value: r._count._all,
          })),
        }

        // ---- Top posts por views (últimos 30 dias) ----
        const topViews = await prisma.postView.groupBy({
          by: ["postId"],
          where: {
            status: ViewStatus.APPLIED,
            createdAt: { gte: last30Start, lt: last30End },
          },
          _count: { _all: true },
          orderBy: { _count: { id: "desc" } },
          take: 5, // ajuste conforme o que quer exibir
        })

        const postIds = topViews.map((t) => t.postId)
        const posts = postIds.length
          ? await prisma.post.findMany({
              where: { id: { in: postIds } },
              select: { id: true, title: true, slug: true },
            })
          : []

        const postMap = new Map(posts.map((p) => [p.id, p]))
        const topPosts = topViews
          .map((t) => {
            const p = postMap.get(t.postId)
            if (!p) return null
            return {
              postId: p.id,
              title: p.title,
              slug: p.slug,
              views: t._count._all,
            }
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))

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

          viewsDaily,
          engagement,
          topPosts,
        })
      },
    )
}
