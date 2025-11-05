import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { BadRequestError } from "@/http/_errors/bad-request-error" // crie se ainda não existir
import { auth } from "@/http/middlewares/auth"
import { Role, PostStatus, Visibility } from "@prisma/client"
import {
  clampExcerpt,
  countWords,
  estimateReadTimeMinutes,
  isoOrNull,
  jsonToPlainText,
  makeUniqueSlug,
  slugify,
} from "@/utils/blog-utils"

export async function createPost(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      "/blog/posts",
      {
        schema: {
          tags: ["Posts"],
          summary: "Create a post",
          body: z.object({
            title: z.string().min(3).max(160),
            slug: z.string().min(1).max(140).optional(),
            excerpt: z.string().max(300).optional(),
            content: z.any(),
            coverId: z.string().uuid().nullable().optional(),

            status: z.nativeEnum(PostStatus).default(PostStatus.DRAFT),
            visibility: z.nativeEnum(Visibility).default(Visibility.PUBLIC),

            scheduledFor: z.string().datetime().optional(),

            categoryNames: z
              .array(
                z
                  .string()
                  .min(1, "categoria vazia")
                  .max(60, "categoria muito longa")
                  .transform((s) => s.trim()),
              )
              .optional(),

            tagNames: z
              .array(
                z
                  .string()
                  .min(1, "tag vazia")
                  .max(60, "tag muito longa")
                  .transform((s) => s.trim()),
              )
              .optional(),
          }),
          response: {
            201: z.object({
              id: z.string().uuid(),
              slug: z.string(),
              status: z.nativeEnum(PostStatus),
              visibility: z.nativeEnum(Visibility),
              publishedAt: z.string().datetime().nullable(),
              scheduledFor: z.string().datetime().nullable(),
              wordCount: z.number().int(),
              readTime: z.number().int(),
              createdAt: z.string().datetime(),
              updatedAt: z.string().datetime(),
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
            "Você não tem permissão para criar posts.",
          )
        }

        const {
          title,
          slug: slugInput,
          excerpt,
          content,
          coverId,
          status,
          visibility,
          scheduledFor,
          categoryNames = [],
          tagNames = [],
        } = request.body

        // regras de datas/status
        let publishedAt: Date | null = null
        let scheduledAt: Date | null = null

        if (status === PostStatus.SCHEDULED) {
          if (!scheduledFor) {
            throw new BadRequestError(
              "Posts agendados requerem 'scheduledFor'.",
            )
          }
          const when = new Date(scheduledFor)
          if (Number.isNaN(when.getTime())) {
            throw new BadRequestError("'scheduledFor' inválido.")
          }
          const now = new Date()
          if (when <= now) {
            throw new BadRequestError("'scheduledFor' deve ser no futuro.")
          }

          // (opcional) truncar ms:
          when.setMilliseconds(0)

          scheduledAt = when
        }

        if (status === PostStatus.PUBLISHED) {
          publishedAt = new Date()
        }

        // slug único para o post
        const baseSlug = slugify(
          slugInput && slugInput.length > 0 ? slugInput : title,
        )
        const uniqueSlug = await makeUniqueSlug(baseSlug)

        // métricas e excerpt
        const plain = jsonToPlainText(content)
        const wc = countWords(plain)
        const rt = estimateReadTimeMinutes(wc)
        const finalExcerpt = clampExcerpt(excerpt, plain)

        // cover opcional
        if (coverId) {
          const cover = await prisma.media.findUnique({
            where: { id: coverId },
          })
          if (!cover) throw new BadRequestError("coverId não encontrado.")
        }

        // ---- normalizar categorias e tags por nome -> slug, com dedupe ----
        const normalizedCategories = (categoryNames ?? [])
          .map((name) => ({ name: name.trim(), slug: slugify(name) }))
          .filter(({ name, slug }) => name.length > 0 && slug.length > 0)

        const uniqueCategories = Array.from(
          new Map(normalizedCategories.map((c) => [c.slug, c])).values(),
        )

        const normalizedTags = (tagNames ?? [])
          .map((name) => ({ name: name.trim(), slug: slugify(name) }))
          .filter(({ name, slug }) => name.length > 0 && slug.length > 0)

        const uniqueTags = Array.from(
          new Map(normalizedTags.map((t) => [t.slug, t])).values(),
        )

        const created = await prisma.$transaction(async (tx) => {
          // cria o post
          const post = await tx.post.create({
            data: {
              authorId: user.id,
              title,
              slug: uniqueSlug,
              excerpt: finalExcerpt || null,
              content,
              coverId: coverId ?? null,
              status,
              visibility,
              publishedAt,
              scheduledFor: scheduledAt,
              wordCount: wc,
              readTime: rt,
            },
          })

          // upsert categories e vincular
          if (uniqueCategories.length > 0) {
            const categoryRecords = await Promise.all(
              uniqueCategories.map(({ name, slug }) =>
                tx.category.upsert({
                  where: { slug },
                  update: { name }, // se quiser preservar primeiro nome: use {}
                  create: { name, slug },
                  select: { id: true },
                }),
              ),
            )
            await tx.categoryOnPosts.createMany({
              data: categoryRecords.map(({ id: categoryId }) => ({
                postId: post.id,
                categoryId,
              })),
              skipDuplicates: true,
            })
          }

          // upsert tags e vincular
          if (uniqueTags.length > 0) {
            const tagRecords = await Promise.all(
              uniqueTags.map(({ name, slug }) =>
                tx.tag.upsert({
                  where: { slug },
                  update: { name }, // idem: trocar por {} se quiser congelar nome
                  create: { name, slug },
                  select: { id: true },
                }),
              ),
            )
            await tx.tagOnPosts.createMany({
              data: tagRecords.map(({ id: tagId }) => ({
                postId: post.id,
                tagId,
              })),
              skipDuplicates: true,
            })
          }

          return post
        })

        return reply.code(201).send({
          id: created.id,
          slug: created.slug,
          status: created.status,
          visibility: created.visibility,
          publishedAt: isoOrNull(created.publishedAt),
          scheduledFor: isoOrNull(created.scheduledFor),
          wordCount: created.wordCount,
          readTime: created.readTime,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        })
      },
    )
}
