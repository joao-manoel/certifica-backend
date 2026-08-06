import type { FastifyInstance, FastifyRequest } from "fastify"
import { PortfolioProjectStatus, Prisma, Role } from "@prisma/client"
import { z } from "zod"

import { BadRequestError } from "@/http/_errors/bad-request-error"
import { ConflictError } from "@/http/_errors/conflict-error"
import { ForbiddenError } from "@/http/_errors/forbidden-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { auth } from "@/http/middlewares/auth"
import { writeAuditLog } from "@/lib/audit"
import { prisma } from "@/lib/prisma"
import { slugify } from "@/utils/blog-utils"
import { editorContentSchema, sanitizeEditorContent } from "@/utils/editor-content"

const mediaSelect = {
  id: true, url: true, alt: true, caption: true, credit: true,
  width: true, height: true, dominantClr: true,
} satisfies Prisma.MediaSelect

const categorySelect = { id: true, name: true, slug: true } satisfies Prisma.PortfolioCategorySelect

const projectPayload = z.object({
  title: z.string().trim().min(3, "O título precisa ter pelo menos 3 caracteres.").max(160, "O título pode ter no máximo 160 caracteres."),
  summary: z.string().trim().min(20, "O resumo precisa ter pelo menos 20 caracteres.").max(500, "O resumo pode ter no máximo 500 caracteres."),
  content: editorContentSchema,
  status: z.nativeEnum(PortfolioProjectStatus).default(PortfolioProjectStatus.DRAFT),
  featured: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  location: z.string().trim().max(160).nullable().optional(),
  architects: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  areaSquareMeters: z.number().positive().max(99_999_999).nullable().optional(),
  completionYear: z.number().int().min(1800).max(2200).nullable().optional(),
  clientName: z.string().trim().max(160).nullable().optional(),
  servicesProvided: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  seoTitle: z.string().trim().max(60).nullable().optional(),
  metaDescription: z.string().trim().max(160).nullable().optional(),
  coverId: z.string().uuid().nullable().optional(),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  galleryMediaIds: z.array(z.string().uuid()).max(60).default([]),
})

const updatePayload = projectPayload.partial().extend({ expectedVersion: z.number().int().positive().optional() })

async function editor(request: FastifyRequest, scopes: Array<"portfolio:read" | "portfolio:write" | "portfolio:publish" | "portfolio:categories">) {
  const context = await request.requireScopes(scopes)
  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { id: true, role: true } })
  if (!user || (user.role !== Role.ADMIN && user.role !== Role.EDITOR)) throw new ForbiddenError("Sem permissão para gerenciar o portfólio.")
  return { context, user }
}

async function uniqueSlug(value: string, ignoreId?: string) {
  const base = slugify(value)
  if (!base) throw new BadRequestError("Slug inválido.")
  let candidate = base
  for (let index = 2; index < 1000; index++) {
    const exists = await prisma.portfolioProject.findFirst({ where: { slug: candidate, ...(ignoreId ? { id: { not: ignoreId } } : {}) }, select: { id: true } })
    if (!exists) return candidate
    candidate = `${base}-${index}`
  }
  throw new ConflictError("Não foi possível gerar um slug único.")
}

function serializeMedia(media: { id: string; url: string; alt: string | null; caption: string | null; credit: string | null; width: number | null; height: number | null; dominantClr: string | null }) {
  return media
}

function uniqueMedia<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

const publicInclude = {
  cover: { select: mediaSelect },
  gallery: { orderBy: { position: "asc" as const }, include: { media: { select: mediaSelect } } },
  categories: { include: { category: { select: categorySelect } } },
}

function serializeProject(project: Prisma.PortfolioProjectGetPayload<{ include: typeof publicInclude }>, full = false) {
  const allMedia = uniqueMedia([...(project.cover ? [project.cover] : []), ...project.gallery.map(({ media }) => media)])
  return {
    id: project.id, title: project.title, slug: project.slug, summary: project.summary,
    ...(full ? { content: project.content } : {}), status: project.status,
    publishedAt: project.publishedAt?.toISOString() ?? null, featured: project.featured,
    displayOrder: project.displayOrder, location: project.location, architects: project.architects,
    areaSquareMeters: project.areaSquareMeters ? Number(project.areaSquareMeters) : null,
    completionYear: project.completionYear, clientName: project.clientName,
    servicesProvided: project.servicesProvided, seoTitle: project.seoTitle,
    metaDescription: project.metaDescription, version: project.version,
    createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(),
    categories: project.categories.map(({ category }) => category),
    galleryCount: allMedia.length,
    gallery: (full ? allMedia : allMedia.slice(0, 6)).map(serializeMedia),
  }
}

export async function publicPortfolio(app: FastifyInstance) {
  app.get("/portfolio/projects", async (request) => {
    const query = z.object({ page: z.coerce.number().int().positive().default(1), perPage: z.coerce.number().int().min(1).max(20).default(6), search: z.string().trim().optional(), category: z.string().trim().optional(), featured: z.coerce.boolean().optional() }).parse(request.query)
    const where: Prisma.PortfolioProjectWhereInput = {
      status: PortfolioProjectStatus.PUBLISHED,
      ...(query.featured !== undefined ? { featured: query.featured } : {}),
      ...(query.category ? { categories: { some: { category: { slug: query.category } } } } : {}),
      ...(query.search ? { OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { summary: { contains: query.search, mode: "insensitive" } },
        { location: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    }
    const [total, items] = await Promise.all([
      prisma.portfolioProject.count({ where }),
      prisma.portfolioProject.findMany({ where, include: publicInclude, orderBy: [{ featured: "desc" }, { displayOrder: "asc" }, { publishedAt: "desc" }], skip: (query.page - 1) * query.perPage, take: query.perPage }),
    ])
    return { items: items.map((item) => serializeProject(item)), meta: { page: query.page, perPage: query.perPage, total, totalPages: Math.max(1, Math.ceil(total / query.perPage)) } }
  })

  app.get("/portfolio/projects/:slug", async (request) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(request.params)
    const project = await prisma.portfolioProject.findFirst({ where: { slug, status: PortfolioProjectStatus.PUBLISHED }, include: publicInclude })
    if (!project) throw new NotFoundError("Projeto não encontrado.")
    return { project: serializeProject(project, true) }
  })

  app.get("/portfolio/projects/:slug/related", async (request) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(request.params)
    const current = await prisma.portfolioProject.findFirst({ where: { slug, status: PortfolioProjectStatus.PUBLISHED }, select: { id: true, categories: { select: { categoryId: true } } } })
    if (!current) throw new NotFoundError("Projeto não encontrado.")
    const items = await prisma.portfolioProject.findMany({ where: { id: { not: current.id }, status: PortfolioProjectStatus.PUBLISHED, categories: { some: { categoryId: { in: current.categories.map((item) => item.categoryId) } } } }, include: publicInclude, orderBy: { publishedAt: "desc" }, take: 6 })
    return { items: items.map((item) => serializeProject(item)) }
  })

  app.get("/portfolio/categories", async () => ({ items: await prisma.portfolioCategory.findMany({ where: { projects: { some: { project: { status: PortfolioProjectStatus.PUBLISHED } } } }, select: { ...categorySelect, description: true, displayOrder: true, _count: { select: { projects: true } } }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }) }))
}

export async function adminPortfolio(app: FastifyInstance) {
  app.register(async (admin) => {
    await admin.register(auth)

    admin.get("/portfolio/admin/projects", async (request) => {
      await editor(request, ["portfolio:read"])
      const query = z.object({ page: z.coerce.number().int().positive().default(1), perPage: z.coerce.number().int().min(1).max(50).default(12), search: z.string().trim().optional(), status: z.nativeEnum(PortfolioProjectStatus).optional(), categoryId: z.string().uuid().optional() }).parse(request.query)
      const where: Prisma.PortfolioProjectWhereInput = { ...(query.status ? { status: query.status } : {}), ...(query.categoryId ? { categories: { some: { categoryId: query.categoryId } } } : {}), ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { location: { contains: query.search, mode: "insensitive" } }] } : {}) }
      const [total, items, published, drafts] = await Promise.all([
        prisma.portfolioProject.count({ where }),
        prisma.portfolioProject.findMany({ where, include: publicInclude, orderBy: { updatedAt: "desc" }, skip: (query.page - 1) * query.perPage, take: query.perPage }),
        prisma.portfolioProject.count({ where: { status: PortfolioProjectStatus.PUBLISHED } }),
        prisma.portfolioProject.count({ where: { status: PortfolioProjectStatus.DRAFT } }),
      ])
      return { items: items.map((item) => serializeProject(item)), meta: { page: query.page, perPage: query.perPage, total, totalPages: Math.max(1, Math.ceil(total / query.perPage)) }, stats: { total: await prisma.portfolioProject.count(), published, drafts } }
    })

    admin.get("/portfolio/admin/projects/:id", async (request) => {
      await editor(request, ["portfolio:read"])
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const project = await prisma.portfolioProject.findUnique({ where: { id }, include: publicInclude })
      if (!project) throw new NotFoundError("Projeto não encontrado.")
      return { project: serializeProject(project, true) }
    })

    admin.post("/portfolio/admin/projects", async (request, reply) => {
      const actor = await editor(request, ["portfolio:write"])
      const data = projectPayload.parse(request.body)
      if (data.status === PortfolioProjectStatus.PUBLISHED) await request.requireScopes(["portfolio:publish"])
      const slug = await uniqueSlug(data.title)
      const content = sanitizeEditorContent(data.content)
      const project = await prisma.$transaction(async (tx) => {
        const created = await tx.portfolioProject.create({ data: { title: data.title, slug, summary: data.summary, content, status: data.status, publishedAt: data.status === PortfolioProjectStatus.PUBLISHED ? new Date() : null, featured: data.featured, displayOrder: data.displayOrder, location: data.location, architects: data.architects, areaSquareMeters: data.areaSquareMeters, completionYear: data.completionYear, clientName: data.clientName, servicesProvided: data.servicesProvided, seoTitle: data.seoTitle, metaDescription: data.metaDescription, coverId: data.coverId, createdById: actor.user.id } })
        if (data.categoryIds.length) await tx.portfolioCategoryOnProjects.createMany({ data: [...new Set(data.categoryIds)].map((categoryId) => ({ projectId: created.id, categoryId })) })
        if (data.galleryMediaIds.length) await tx.portfolioProjectMedia.createMany({ data: [...new Set(data.galleryMediaIds)].map((mediaId, position) => ({ projectId: created.id, mediaId, position })) })
        return tx.portfolioProject.findUniqueOrThrow({ where: { id: created.id }, include: publicInclude })
      })
      await writeAuditLog(actor.context, "portfolio.project.create", "PortfolioProject", project.id, { status: project.status })
      return reply.status(201).send({ project: serializeProject(project, true) })
    })

    admin.patch("/portfolio/admin/projects/:id", async (request) => {
      const actor = await editor(request, ["portfolio:write"])
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const data = updatePayload.parse(request.body)
      const existing = await prisma.portfolioProject.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError("Projeto não encontrado.")
      if (data.expectedVersion && data.expectedVersion !== existing.version) throw new ConflictError(`Conflito de versão. Atual: ${existing.version}.`)
      if (data.status === PortfolioProjectStatus.PUBLISHED) await request.requireScopes(["portfolio:publish"])
      const { categoryIds, galleryMediaIds, expectedVersion: _expectedVersion, content, ...fields } = data
      const patch: Prisma.PortfolioProjectUpdateInput = { ...fields, ...(data.title !== undefined && data.title !== existing.title ? { slug: await uniqueSlug(data.title, id) } : {}), ...(content ? { content: sanitizeEditorContent(content) } : {}), ...(data.status ? { publishedAt: data.status === PortfolioProjectStatus.PUBLISHED ? existing.publishedAt ?? new Date() : null } : {}), version: { increment: 1 } }
      const project = await prisma.$transaction(async (tx) => {
        await tx.portfolioProject.update({ where: { id }, data: patch })
        if (categoryIds) { await tx.portfolioCategoryOnProjects.deleteMany({ where: { projectId: id } }); if (categoryIds.length) await tx.portfolioCategoryOnProjects.createMany({ data: [...new Set(categoryIds)].map((categoryId) => ({ projectId: id, categoryId })) }) }
        if (galleryMediaIds) { await tx.portfolioProjectMedia.deleteMany({ where: { projectId: id } }); if (galleryMediaIds.length) await tx.portfolioProjectMedia.createMany({ data: [...new Set(galleryMediaIds)].map((mediaId, position) => ({ projectId: id, mediaId, position })) }) }
        return tx.portfolioProject.findUniqueOrThrow({ where: { id }, include: publicInclude })
      })
      await writeAuditLog(actor.context, "portfolio.project.update", "PortfolioProject", id, { status: project.status, version: project.version })
      return { project: serializeProject(project, true) }
    })

    admin.delete("/portfolio/admin/projects/:id", async (request) => {
      const actor = await editor(request, ["portfolio:write"])
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
      const existing = await prisma.portfolioProject.findUnique({ where: { id }, select: { id: true } })
      if (!existing) throw new NotFoundError("Projeto não encontrado.")
      await prisma.portfolioProject.delete({ where: { id } })
      await writeAuditLog(actor.context, "portfolio.project.delete", "PortfolioProject", id)
      return { id, deleted: true }
    })

    admin.get("/portfolio/admin/categories", async (request) => { await editor(request, ["portfolio:read"]); return { items: await prisma.portfolioCategory.findMany({ select: { ...categorySelect, description: true, displayOrder: true, _count: { select: { projects: true } } }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }) } })
    admin.post("/portfolio/admin/categories", async (request, reply) => { const actor = await editor(request, ["portfolio:categories"]); const data = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).nullable().optional(), displayOrder: z.number().int().default(0) }).parse(request.body); const slug = slugify(data.name); try { const category = await prisma.portfolioCategory.create({ data: { ...data, slug } }); await writeAuditLog(actor.context, "portfolio.category.create", "PortfolioCategory", category.id); return reply.status(201).send({ category }) } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictError("Categoria já cadastrada."); throw error } })
    admin.patch("/portfolio/admin/categories/:id", async (request) => { const actor = await editor(request, ["portfolio:categories"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const data = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(300).nullable().optional(), displayOrder: z.number().int().optional() }).parse(request.body); const category = await prisma.portfolioCategory.update({ where: { id }, data: { ...data, ...(data.name ? { slug: slugify(data.name) } : {}) } }).catch(() => { throw new NotFoundError("Categoria não encontrada.") }); await writeAuditLog(actor.context, "portfolio.category.update", "PortfolioCategory", id); return { category } })
    admin.delete("/portfolio/admin/categories/:id", async (request) => { const actor = await editor(request, ["portfolio:categories"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const category = await prisma.portfolioCategory.findUnique({ where: { id }, select: { id: true, _count: { select: { projects: true } } } }); if (!category) throw new NotFoundError("Categoria não encontrada."); if (category._count.projects) throw new ConflictError("A categoria está em uso.", { usageCount: category._count.projects }); await prisma.portfolioCategory.delete({ where: { id } }); await writeAuditLog(actor.context, "portfolio.category.delete", "PortfolioCategory", id); return { id, deleted: true } })
  })
}
