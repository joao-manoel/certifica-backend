import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, ViewStatus } from "@prisma/client"
import { getMonthBoundaries, pctDelta } from "@/utils/metrics-utils"

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
            "Métricas do mês atual para o dashboard (posts, views, engajamento e top posts)",
          response: {
            200: z.object({
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

              viewsDaily: z.array(
                z.object({
                  day: z.string(), // yyyyMMdd
                  value: z.number().int().nonnegative(),
                }),
              ),

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
        if (user.role !== Role.ADMIN && user.role !== Role.EDITOR)
          throw new UnauthorizedError(
            "Você não tem permissão para consultar métricas.",
          )

        const { monthStart, nextMonthStart, prevMonthStart, prevMonthEnd } =
          getMonthBoundaries(new Date())

        // 1️⃣ POSTS PUBLICADOS — mês atual e anterior
        const [publishedThisMonth, publishedPrevMonth] =
          await prisma.$transaction([
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
          ])

        // 2️⃣ VISUALIZAÇÕES — mês atual e anterior
        const [viewsThisMonth, viewsPrevMonth] = await prisma.$transaction([
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
        const growthRateMonthly = viewsMoM

        type RawDaily = { day: string; count: number }

        const rawDaily = await prisma.$queryRaw<RawDaily[]>`
          WITH days AS (
            SELECT generate_series(
              date_trunc('month', ${monthStart}::timestamptz),
              date_trunc('month', ${nextMonthStart}::timestamptz) - interval '1 day',
              interval '1 day'
            )::date AS d
          ),
          agg AS (
            SELECT
              ("createdAt" AT TIME ZONE 'UTC')::date AS d,
              COUNT(*)::int AS c
            FROM "PostView"
            WHERE "status" = ${ViewStatus.APPLIED}
              AND "createdAt" >= ${monthStart}
              AND "createdAt" < ${nextMonthStart}
            GROUP BY 1
          )
          SELECT
            to_char(days.d, 'YYYYMMDD') AS day,
            COALESCE(agg.c, 0) AS count
          FROM days
          LEFT JOIN agg ON agg.d = days.d
          ORDER BY days.d;
        `

        const viewsDaily = rawDaily.map((r) => ({
          day: r.day, // yyyyMMdd
          value: Number(r.count),
        }))

        // 4️⃣ ENGAJAMENTO (mês atual)
        const TOP_N = 6
        const [gDevices, gBrowsers, gOS, gCountries, gReferrers] =
          await Promise.all([
            prisma.postView.groupBy({
              by: ["device"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: monthStart, lt: nextMonthStart },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["browser"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: monthStart, lt: nextMonthStart },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["os"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: monthStart, lt: nextMonthStart },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["country"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: monthStart, lt: nextMonthStart },
              },
              _count: { _all: true },
              orderBy: { _count: { id: "desc" } },
              take: TOP_N,
            }),
            prisma.postView.groupBy({
              by: ["referrer"],
              where: {
                status: ViewStatus.APPLIED,
                createdAt: { gte: monthStart, lt: nextMonthStart },
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

        // 5️⃣ TOP POSTS DO MÊS (por views)
        const topViews = await prisma.postView.groupBy({
          by: ["postId"],
          where: {
            status: ViewStatus.APPLIED,
            createdAt: { gte: monthStart, lt: nextMonthStart },
          },
          _count: { _all: true },
          orderBy: { _count: { id: "desc" } },
          take: 5,
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
            return p
              ? {
                  postId: p.id,
                  title: p.title,
                  slug: p.slug,
                  views: t._count._all,
                }
              : null
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))

        return reply.send({
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
