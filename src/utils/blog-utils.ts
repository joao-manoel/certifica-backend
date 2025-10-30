import { prisma } from "@/lib/prisma"

/**
 * Extrai texto simples de um JSON arbitrário de editor.
 * Estratégia defensiva: procura campos "text" recursivamente; se nada encontrado,
 * fallback para stringificar e limpar.
 */
export function jsonToPlainText(content: unknown): string {
  const out: string[] = []
  const visit = (node: any) => {
    if (!node) return
    if (typeof node === "string") {
      out.push(node)
      return
    }
    if (typeof node.text === "string") out.push(node.text)
    if (Array.isArray(node)) node.forEach(visit)
    else if (typeof node === "object") Object.values(node).forEach(visit)
  }
  visit(content)
  const text = out.join(" ").trim()
  if (text.length > 0) return text.replace(/\s+/g, " ")
  // fallback ultra-defensivo
  try {
    return JSON.stringify(content)
      .replace(/["{}\[\],:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  } catch {
    return ""
  }
}

export function clampExcerpt(input: string | undefined, derived: string) {
  const base = (input ?? derived).trim()
  return base.length <= 300 ? base : base.slice(0, 297).trimEnd() + "..."
}

export function countWords(s: string) {
  if (!s) return 0
  const words = s.trim().split(/\s+/).filter(Boolean)
  return words.length
}

export function estimateReadTimeMinutes(wordCount: number) {
  const WPM = 200 // média conservadora
  return Math.max(1, Math.ceil(wordCount / WPM))
}

export function isoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null
}

export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

export async function makeUniqueSlug(base: string) {
  let candidate = base
  let suffix = 1

  // tenta até encontrar um slug livre
  while (true) {
    const exists = await prisma.post.findUnique({ where: { slug: candidate } })
    if (!exists) return candidate
    candidate = `${base}-${suffix++}`
  }
}
