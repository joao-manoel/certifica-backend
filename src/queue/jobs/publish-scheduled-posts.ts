import type { Job } from "bull"
import { prisma } from "@/lib/prisma"

/**
 * Publicação segura e idempotente:
 * - Busca lote de posts SCHEDULED vencidos (scheduledFor <= now())
 * - Para cada ID, tenta updateMany com cláusula WHERE reforçando status e data
 * - Se count===1, foi publicado nesta tentativa (evita corrida/duplo publish)
 * - Aplica efeitos colaterais por post, mas sem bloquear o loop (try/catch por item)
 */

const BATCH_SIZE = 100

async function fetchDueIds(limit: number): Promise<string[]> {
  const now = new Date()
  const rows = await prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      scheduledFor: { lte: now },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    select: { id: true },
    take: limit,
  })
  return rows.map((r) => r.id)
}

async function publishOne(postId: string): Promise<"PUBLISHED" | "SKIPPED"> {
  const now = new Date()

  // updateMany para condicionar status e data (idempotência / corrida)
  const res = await prisma.post.updateMany({
    where: {
      id: postId,
      status: "SCHEDULED",
      scheduledFor: { lte: now },
    },
    data: {
      status: "PUBLISHED",
      publishedAt: now,
    },
  })

  if (res.count === 1) {
    // Efeitos colaterais NÃO críticos (em best-effort):
    // - revalidar caches/tag
    // - pingar RSS/Sitemap
    // - enviar webhooks/notify
    try {
      await afterPublishSideEffects(postId)
    } catch (err) {
      // loga mas não fracassa o job principal
      console.error("[PublishScheduledPosts] side-effects error:", err)
    }
    return "PUBLISHED"
  }
  return "SKIPPED"
}

async function afterPublishSideEffects(postId: string) {
  // Stubs — encaixe o que você já usa hoje no seu projeto:
  // - ex: await revalidateTag('posts'); await revalidateTag(`post:${postId}`)
  // - ex: await pingSitemap(); await rebuildRss();
  // - ex: await sendWebhook({ type: 'post.published', postId })
  return
}

export interface PublishScheduledPostsData {}

export default {
  key: "PublishScheduledPosts",

  options: {
    // roda a cada 1 minuto (ajuste conforme necessidade)
    repeat: { cron: "*/1 * * * *" },
    removeOnComplete: true,
    removeOnFail: 50,
    // Se quiser limitar concorrência global desta fila:
    limiter: { max: 1, duration: 60_000 },
  },

  async handle(_job: Job<PublishScheduledPostsData>) {
    // Loop por lotes para não estourar o tempo de um tick
    // e para não segurar a fila por muito tempo.
    let processed = 0

    for (;;) {
      const ids = await fetchDueIds(BATCH_SIZE)
      if (ids.length === 0) break

      for (const id of ids) {
        try {
          await publishOne(id)
          processed++
        } catch (err) {
          console.error("[PublishScheduledPosts] ❌ erro ao publicar", id, err)
          // continua nos demais IDs
        }
      }

      // Se veio menos que o lote, acabou
      if (ids.length < BATCH_SIZE) break
      // Caso contrário, volta e busca próximo lote no estado atual.
    }

    if (processed > 0) {
      console.log(`[PublishScheduledPosts] ✅ publicados: ${processed}`)
    }
  },
}
