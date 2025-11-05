import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import { auth } from "@/http/middlewares/auth"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { BadRequestError } from "@/http/_errors/bad-request-error"
import { Role, PostStatus, Visibility } from "@prisma/client"
import {
  clampExcerpt,
  countWords,
  estimateReadTimeMinutes,
  isoOrNull,
  jsonToPlainText,
  slugify,
} from "@/utils/blog-utils"

// helper local para garantir slug único, preservando o próprio post
async function ensureUniqueSlug(base: string, currentPostId: string) {
  const baseSlug = slugify(base)
  if (!baseSlug) throw new BadRequestError("slug inválido.")

  let candidate = baseSlug
  let suffix = 2

  // se já é o slug do próprio post, ok
  const self = await prisma.post.findFirst({
    where: { id: currentPostId, slug: candidate },
    select: { id: true },
  })
  if (self) return candidate

  for (let i = 0; i < 1000; i++) {
    const found = await prisma.post.findFirst({
      where: { slug: candidate, NOT: { id: currentPostId } },
      select: { id: true },
    })
    if (!found) return candidate
    candidate = `${baseSlug}-${suffix++}`
  }

  throw new BadRequestError("não foi possível gerar um slug único.")
}

export async function editPost(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      "/blog/admin/posts/:id",
      {
        schema: {
          tags: ["Posts"],
          summary: "Edit a post",
          params: z.object({
            id: z.string().uuid(),
          }),
          body: z.object({
            title: z.string().min(3).max(160).optional(),
            slug: z.string().min(1).max(140).optional(),
            excerpt: z.string().max(300).optional(),
            content: z.any().optional(),
            coverId: z.string().uuid().nullable().optional(),

            status: z.nativeEnum(PostStatus).optional(),
            visibility: z.nativeEnum(Visibility).optional(),
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
            200: z.object({
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
            "Você não tem permissão para editar posts.",
          )
        }

        const { id } = request.params

        const existing = await prisma.post.findUnique({
          where: { id },
          select: {
            id: true,
            slug: true,
            title: true,
            excerpt: true,
            content: true,
            status: true,
            visibility: true,
            publishedAt: true,
            scheduledFor: true,
            coverId: true,
            createdAt: true,
            updatedAt: true,
            // ★ incluir para evitar indexação dinâmica
            wordCount: true,
            readTime: true,
          },
        })

        if (!existing) {
          throw new BadRequestError("Post não encontrado.")
        }

        const {
          title,
          slug,
          excerpt,
          content,
          coverId,
          status,
          visibility,
          scheduledFor,
          categoryNames,
          tagNames,
        } = request.body

        // Validar coverId (quando enviado não-nulo)
        if (coverId !== undefined && coverId !== null) {
          const cover = await prisma.media.findUnique({
            where: { id: coverId },
          })
          if (!cover) throw new BadRequestError("coverId não encontrado.")
        }

        // Regras de status/datas
        let nextStatus = status ?? existing.status
        let nextPublishedAt: Date | null = existing.publishedAt ?? null
        let nextScheduledFor: Date | null =
          scheduledFor !== undefined
            ? new Date(scheduledFor)
            : (existing.scheduledFor ?? null)

        if (status === PostStatus.SCHEDULED) {
          if (!scheduledFor)
            throw new BadRequestError(
              "Posts agendados requerem 'scheduledFor'.",
            )
          const when = new Date(scheduledFor)
          if (Number.isNaN(when.getTime()))
            throw new BadRequestError("'scheduledFor' inválido.")
          if (when <= new Date())
            throw new BadRequestError("'scheduledFor' deve ser no futuro.")
          nextScheduledFor = when
          nextPublishedAt = null
        } else if (status === PostStatus.PUBLISHED) {
          nextPublishedAt = existing.publishedAt ?? new Date()
          nextScheduledFor = null
        } else if (status === PostStatus.DRAFT) {
          nextPublishedAt = null
          nextScheduledFor = null
        }

        // Slug: se enviado e mudou, normaliza e garante unicidade
        let nextSlug = existing.slug
        if (slug !== undefined) {
          const normalized = slugify(slug)
          if (!normalized) throw new BadRequestError("slug inválido.")
          if (normalized !== existing.slug) {
            nextSlug = await ensureUniqueSlug(normalized, existing.id)
          }
        }

        // Métricas/excerpt: recalcula só se content/excerpt mudarem
        const newContent = content !== undefined ? content : existing.content
        const plain = jsonToPlainText(newContent)
        const shouldRecompute = content !== undefined || excerpt !== undefined

        // ★ sem indexação dinâmica
        const nextWordCount = shouldRecompute
          ? countWords(plain)
          : existing.wordCount
        const nextReadTime = shouldRecompute
          ? estimateReadTimeMinutes(nextWordCount)
          : existing.readTime

        const finalExcerpt =
          excerpt !== undefined
            ? clampExcerpt(excerpt, plain) || null
            : clampExcerpt(existing.excerpt ?? undefined, plain) || null

        // Normalizar categorias/tags se enviados
        const normalizedCategories =
          categoryNames
            ?.map((name) => ({ name: name.trim(), slug: slugify(name) }))
            .filter(({ name, slug }) => name.length > 0 && slug.length > 0) ??
          null

        const uniqueCategories = normalizedCategories
          ? Array.from(
              new Map(normalizedCategories.map((c) => [c.slug, c])).values(),
            )
          : null

        const normalizedTags =
          tagNames
            ?.map((name) => ({ name: name.trim(), slug: slugify(name) }))
            .filter(({ name, slug }) => name.length > 0 && slug.length > 0) ??
          null

        const uniqueTags = normalizedTags
          ? Array.from(new Map(normalizedTags.map((t) => [t.slug, t])).values())
          : null

        const updated = await prisma.$transaction(async (tx) => {
          // upsert coverId: se coverId for null explícito, zera; se undefined, mantém
          const coverPatch =
            coverId === undefined ? {} : { coverId: coverId ?? null }

          const patchData = {
            ...(title !== undefined ? { title } : {}),
            ...(slug !== undefined ? { slug: nextSlug } : {}),
            ...(excerpt !== undefined ? { excerpt: finalExcerpt } : {}),
            ...(content !== undefined ? { content: newContent } : {}),
            ...(visibility !== undefined ? { visibility } : {}),
            ...(status !== undefined ? { status: nextStatus } : {}),
            ...(status !== undefined || scheduledFor !== undefined
              ? { scheduledFor: nextScheduledFor }
              : {}),
            ...(status !== undefined ? { publishedAt: nextPublishedAt } : {}),
            ...coverPatch,
            ...(shouldRecompute
              ? {
                  wordCount: nextWordCount,
                  readTime: nextReadTime,
                }
              : {}),
          } satisfies Parameters<typeof prisma.post.update>[0]["data"]

          const post = await tx.post.update({
            where: { id: existing.id },
            data: patchData,
          })

          // Se categorias foram enviadas, substitui relações
          if (uniqueCategories) {
            await tx.categoryOnPosts.deleteMany({ where: { postId: post.id } })

            if (uniqueCategories.length > 0) {
              const categoryRecords = await Promise.all(
                uniqueCategories.map(({ name, slug }) =>
                  tx.category.upsert({
                    where: { slug },
                    update: { name },
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
          }

          // Se tags foram enviadas, substitui relações
          if (uniqueTags) {
            await tx.tagOnPosts.deleteMany({ where: { postId: post.id } })

            if (uniqueTags.length > 0) {
              const tagRecords = await Promise.all(
                uniqueTags.map(({ name, slug }) =>
                  tx.tag.upsert({
                    where: { slug },
                    update: { name },
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
          }

          return post
        })

        // ★ sem cast para any; os campos existem no modelo
        return reply.code(200).send({
          id: updated.id,
          slug: updated.slug,
          status: updated.status,
          visibility: updated.visibility,
          publishedAt: isoOrNull(updated.publishedAt),
          scheduledFor: isoOrNull(updated.scheduledFor),
          wordCount: updated.wordCount,
          readTime: updated.readTime,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        })
      },
    )
}
