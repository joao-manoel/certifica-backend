import bcrypt from "bcrypt"
import type { FastifyInstance, FastifyRequest } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { Prisma, Role } from "@prisma/client"
import { z } from "zod"

import { ConflictError } from "@/http/_errors/conflict-error"
import { ForbiddenError } from "@/http/_errors/forbidden-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { auth } from "@/http/middlewares/auth"
import { writeAuditLog } from "@/lib/audit"
import { prisma } from "@/lib/prisma"

const userSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

async function requireAdmin(request: FastifyRequest) {
  const context = await request.getEditorContext()
  if (context.kind !== "user") {
    throw new ForbiddenError("Integrações não podem gerenciar usuários.")
  }
  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: { id: true, role: true, isActive: true },
  })
  if (!user?.isActive || user.role !== Role.ADMIN) {
    throw new ForbiddenError("Apenas administradores podem gerenciar usuários.")
  }
  return { context, user }
}

const createSchema = z
  .object({
    name: z.string().trim().min(3).max(100),
    username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().email().optional().nullable(),
    role: z.nativeEnum(Role).default(Role.USER),
    temporaryPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.temporaryPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "A confirmação não confere com a senha.",
  })

const updateSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  email: z.string().trim().email().nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
})

export async function adminUsers(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().register(auth)

  app.get("/admin/users", async (request) => {
    await requireAdmin(request)
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      perPage: z.coerce.number().int().min(1).max(100).default(12),
      search: z.string().trim().optional(),
      role: z.nativeEnum(Role).optional(),
      status: z.enum(["active", "inactive"]).optional(),
    }).parse(request.query)
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { isActive: query.status === "active" } : {}),
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { username: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    }
    const [items, total, active, admins, editors] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.perPage, take: query.perPage }),
      prisma.user.count({ where }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { role: Role.ADMIN, isActive: true } }),
      prisma.user.count({ where: { role: Role.EDITOR, isActive: true } }),
    ])
    return { items, pagination: { page: query.page, perPage: query.perPage, total, totalPages: Math.max(1, Math.ceil(total / query.perPage)) }, stats: { total: await prisma.user.count(), active, admins, editors } }
  })

  app.get("/admin/users/:id", async (request) => {
    await requireAdmin(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const user = await prisma.user.findUnique({ where: { id }, select: userSelect })
    if (!user) throw new NotFoundError("Usuário não encontrado.")
    return { user }
  })

  app.post("/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request)
    const data = createSchema.parse(request.body)
    const duplicate = await prisma.user.findFirst({ where: { OR: [
      { username: data.username },
      ...(data.email ? [{ email: data.email }] : []),
    ] } })
    if (duplicate) throw new ConflictError("Username ou e-mail já cadastrado.")
    const user = await prisma.user.create({ data: {
      name: data.name, username: data.username, email: data.email || null,
      role: data.role, password: await bcrypt.hash(data.temporaryPassword, 10),
      mustChangePassword: true, passwordChangedAt: new Date(),
    }, select: userSelect })
    await writeAuditLog(admin.context, "user.create", "User", user.id, { role: user.role })
    return reply.status(201).send({ user })
  })

  app.patch("/admin/users/:id", async (request) => {
    const admin = await requireAdmin(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const data = updateSchema.parse(request.body)
    const target = await prisma.user.findUnique({ where: { id }, select: userSelect })
    if (!target) throw new NotFoundError("Usuário não encontrado.")
    if (id === admin.user.id && data.isActive === false) throw new ConflictError("Você não pode inativar a própria conta.")
    if (target.role === Role.ADMIN && target.isActive && (data.role && data.role !== Role.ADMIN || data.isActive === false)) {
      const activeAdmins = await prisma.user.count({ where: { role: Role.ADMIN, isActive: true } })
      if (activeAdmins <= 1) throw new ConflictError("O último administrador ativo não pode ser rebaixado ou inativado.")
    }
    if (data.username || data.email) {
      const duplicate = await prisma.user.findFirst({ where: { id: { not: id }, OR: [
        ...(data.username ? [{ username: data.username }] : []),
        ...(data.email ? [{ email: data.email }] : []),
      ] } })
      if (duplicate) throw new ConflictError("Username ou e-mail já cadastrado.")
    }
    const user = await prisma.user.update({ where: { id }, data, select: userSelect })
    await writeAuditLog(admin.context, "user.update", "User", id, { previousRole: target.role, role: user.role, previousActive: target.isActive, isActive: user.isActive })
    return { user }
  })

  app.put("/admin/users/:id/password", async (request) => {
    const admin = await requireAdmin(request)
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    if (id === admin.user.id) throw new ConflictError("Use as configurações pessoais para trocar sua própria senha.")
    const data = z.object({ newPassword: z.string().min(8).max(128), confirmPassword: z.string(), forceChangeOnNextLogin: z.boolean().default(true) }).refine((value) => value.newPassword === value.confirmPassword, { path: ["confirmPassword"], message: "A confirmação não confere com a senha." }).parse(request.body)
    const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } })
    if (!exists) throw new NotFoundError("Usuário não encontrado.")
    await prisma.user.update({ where: { id }, data: { password: await bcrypt.hash(data.newPassword, 10), passwordChangedAt: new Date(), mustChangePassword: data.forceChangeOnNextLogin, sessionVersion: { increment: 1 } } })
    await writeAuditLog(admin.context, "user.password_reset", "User", id, { forceChangeOnNextLogin: data.forceChangeOnNextLogin })
    return { id, updated: true }
  })
}
