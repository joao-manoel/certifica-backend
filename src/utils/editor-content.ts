import sanitizeHtml from "sanitize-html"
import { z } from "zod"

export const editorContentSchema = z.object({
  format: z.literal("html"),
  version: z.literal(1),
  html: z.string().min(1).max(250_000),
})

const allowedTags = [
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "blockquote",
  "figure",
  "img",
  "figcaption",
  "div",
  "span",
  "hr",
]

export function sanitizeEditorContent(content: z.infer<typeof editorContentSchema>) {
  return {
    ...content,
    html: sanitizeHtml(content.html, {
      allowedTags,
      allowedAttributes: {
        "*": ["style"],
        a: ["href", "target", "rel", "style"],
        img: ["src", "alt", "style"],
      },
      allowedSchemes: ["http", "https", "mailto"],
      allowedSchemesByTag: {
        img: ["http", "https"],
      },
      allowedStyles: {
        "*": {
          color: [/^#[0-9a-f]{3,8}$/i, /^rgb/],
          "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb/],
          background: [/^#[0-9a-f]{3,8}$/i],
          "border-left": [/^[\w\s#().,%/-]+$/],
          "border-bottom": [/^[\w\s#().,%/-]+$/],
          "border-radius": [/^[\d.\s%a-z]+$/i],
          padding: [/^[\d.\s%a-z]+$/i],
          "padding-bottom": [/^[\d.\s%a-z]+$/i],
          margin: [/^[\d.\s%a-z-]+$/i],
          "margin-top": [/^[\d.\s%a-z-]+$/i],
          width: [/^[\d.]+(%|px|em|rem)$/],
          height: [/^(auto|[\d.]+(%|px|em|rem))$/],
          float: [/^(left|right|none)$/],
          clear: [/^(both|left|right|none)$/],
          "font-size": [/^[\d.]+(em|rem|px|%)$/],
          "font-style": [/^(normal|italic)$/],
          "font-weight": [/^(normal|bold|[1-9]00)$/],
          "line-height": [/^[\d.]+(em|rem|px|%)?$/],
          "text-align": [/^(left|center|justify)$/],
        },
      },
      transformTags: {
        a: (_tagName, attribs) => ({
          tagName: "a",
          attribs: {
            ...attribs,
            ...(attribs.target === "_blank"
              ? { rel: "noopener noreferrer" }
              : {}),
          },
        }),
      },
    }),
  }
}

export type PostValidationInput = {
  title: string
  excerpt?: string | null
  seoTitle?: string | null
  metaDescription?: string | null
  focusKeyword?: string | null
  content: z.infer<typeof editorContentSchema>
  coverId?: string | null
}

export function validatePostManifest(input: PostValidationInput) {
  const errors: string[] = []
  const warnings: string[] = []
  const { html } = input.content

  if (input.title.length < 3 || input.title.length > 160) {
    errors.push("O título deve ter entre 3 e 160 caracteres.")
  }
  if (!input.excerpt || input.excerpt.trim().split(/\s+/).length < 8) {
    warnings.push("O resumo deve ter pelo menos 8 palavras.")
  }
  if (input.seoTitle && input.seoTitle.length > 60) {
    errors.push("O título SEO deve ter no máximo 60 caracteres.")
  }
  if (
    input.metaDescription &&
    (input.metaDescription.length < 150 ||
      input.metaDescription.length > 160)
  ) {
    warnings.push("A meta description deve ter entre 150 e 160 caracteres.")
  }
  if (input.focusKeyword) {
    const keyword = input.focusKeyword.toLocaleLowerCase("pt-BR")
    const haystack = `${input.title} ${html}`.toLocaleLowerCase("pt-BR")
    if (!haystack.includes(keyword)) {
      warnings.push("A palavra-chave principal não aparece no título ou corpo.")
    }
  }
  if (/URL-FIGURA-\d+|blob:|file:\/\/|localhost/i.test(html)) {
    errors.push("O conteúdo possui placeholder ou URL local de imagem.")
  }
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)]
  for (const [, attributes] of images) {
    if (!/\balt=(["'])[^"']+\1/i.test(attributes)) {
      errors.push("Todas as imagens do corpo precisam de alt text.")
      break
    }
  }
  if (!input.coverId) warnings.push("O post não possui imagem de capa.")

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      images: images.length,
      words: html
        .replace(/<[^>]+>/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean).length,
    },
  }
}
