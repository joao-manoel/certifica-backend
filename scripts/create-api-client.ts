import { createHash, randomBytes } from "node:crypto"

import { prisma } from "@/lib/prisma"

const allowedScopes = new Set([
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:read",
  "media:write",
])

async function main() {
  const [name, authorIdentifier, scopesInput] = process.argv.slice(2)

  if (!name || !authorIdentifier) {
    console.error(
      "Uso: npm run api-client:create -- <nome> <username-ou-id> [scopes-separados-por-vírgula]",
    )
    process.exitCode = 1
    return
  }

  const scopes = (
    scopesInput ?? "posts:read,posts:write,media:read,media:write"
  )
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)

  if (scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new Error("Um ou mais scopes são inválidos.")
  }

  const author = await prisma.user.findFirst({
    where: {
      OR: [{ id: authorIdentifier }, { username: authorIdentifier }],
    },
    select: { id: true, username: true },
  })

  if (!author) {
    throw new Error(
      `Autor '${authorIdentifier}' não encontrado por username ou ID.`,
    )
  }

  const token = `certifica_${randomBytes(32).toString("base64url")}`
  const tokenHash = createHash("sha256").update(token).digest("hex")

  const client = await prisma.apiClient.create({
    data: {
      name,
      authorId: author.id,
      tokenHash,
      scopes,
    },
    select: { id: true, name: true, scopes: true },
  })

  console.log(
    JSON.stringify({ ...client, author: author.username, token }, null, 2),
  )
  console.error("Guarde o token agora: ele não poderá ser recuperado depois.")
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
