import { createHash, randomBytes } from "node:crypto"

import { prisma } from "@/lib/prisma"

const [name, username, scopesInput] = process.argv.slice(2)

if (!name || !username) {
  console.error(
    "Uso: npm run api-client:create -- <nome> <username> [scopes-separados-por-vírgula]",
  )
  process.exit(1)
}

const scopes = (
  scopesInput ??
  "posts:read,posts:write,media:read,media:write"
)
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean)

const allowedScopes = new Set([
  "posts:read",
  "posts:write",
  "posts:publish",
  "media:read",
  "media:write",
])

if (scopes.some((scope) => !allowedScopes.has(scope))) {
  console.error("Um ou mais scopes são inválidos.")
  process.exit(1)
}

const author = await prisma.user.findUnique({
  where: { username },
  select: { id: true },
})

if (!author) {
  console.error("Autor não encontrado.")
  process.exit(1)
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

console.log(JSON.stringify({ ...client, token }, null, 2))
console.error("Guarde o token agora: ele não poderá ser recuperado depois.")

await prisma.$disconnect()
