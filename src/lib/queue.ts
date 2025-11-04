import Queue, { Job, JobOptions, Queue as QueueType } from "bull"
import * as jobs from "@/queue/jobs"
import { env } from "@/env"
import chalk from "chalk"

interface JobData {
  key: string
  handle: (job: Job) => Promise<void>
  options?: JobOptions // usa options.repeat aqui
}

interface QueueData {
  bull: QueueType
  name: string
  handle: (job: Job) => Promise<void>
  options?: JobOptions
}

const queues: QueueData[] = Object.values(jobs).map((job: JobData) => {
  console.log(chalk.cyanBright(`[Queue] 🚀 Inicializando fila: ${job.key}`))

  const q = new Queue(job.key, {
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    // Se quiser limitar taxa por fila, configure aqui:
    // limiter: { max: 1, duration: 60_000 },
  })

  return {
    bull: q,
    name: job.key,
    handle: job.handle,
    options: job.options,
  }
})

/** Type guards para o repeat do Bull v3 */
function isCronRepeat(
  r: JobOptions["repeat"],
): r is { cron: string; tz?: string } {
  return !!r && "cron" in r && typeof (r as any).cron === "string"
}

function isEveryRepeat(
  r: JobOptions["repeat"],
): r is { every: number; tz?: string } {
  return !!r && "every" in r && typeof (r as any).every === "number"
}

/** Texto amigável para logs do repeat */
function repeatToString(repeat?: JobOptions["repeat"]) {
  if (!repeat) return "-"
  if (isCronRepeat(repeat)) {
    return `cron:${repeat.cron}${repeat.tz ? ` tz:${repeat.tz}` : ""}`
  }
  if (isEveryRepeat(repeat)) {
    return `every:${repeat.every}ms${repeat.tz ? ` tz:${repeat.tz}` : ""}`
  }
  return "repeat"
}

async function ensureRepeatScheduled(queue: QueueData) {
  const repeat = queue.options?.repeat
  if (!repeat) return

  // evita múltiplos schedules em restarts usando jobId estável
  const addOpts: JobOptions = {
    ...queue.options,
    jobId: `repeat:${queue.name}`,
  }

  // lista agendamentos existentes
  const list = await queue.bull.getRepeatableJobs()
  const exists = list.some((r) => r.id === addOpts.jobId)

  if (!exists) {
    await queue.bull.add({}, addOpts)
    console.log(
      chalk.yellowBright(
        `[Queue] ⏰ Repeat agendado para ${queue.name} (${repeatToString(repeat)})`,
      ),
    )
  } else {
    const next = list.find((r) => r.id === addOpts.jobId)
    console.log(
      chalk.gray(
        `[Queue] ⏱️ Repeat já existente para ${queue.name} — próximo em: ${
          next?.next ? new Date(next.next).toISOString() : "desconhecido"
        } (${repeatToString(repeat)})`,
      ),
    )
  }
}

export default {
  queues,

  add<T extends object>(name: string, data: T) {
    const queue = this.queues.find((q) => q.name === name)
    if (!queue) {
      throw new Error(`Queue with name ${name} not found`)
    }

    console.log(
      chalk.yellowBright(`[Queue] ➕ Job adicionado à fila ${name}:`),
      data,
    )
    return queue.bull.add(data, queue.options)
  },

  async process() {
    console.log(
      chalk.cyanBright("[Queue] 🧠 Iniciando processamento das filas..."),
    )

    for (const queue of this.queues) {
      queue.bull.process(async (job: Job) => {
        const start = performance.now()

        try {
          await queue.handle(job)
          const duration = (performance.now() - start).toFixed(1)
        } catch (err) {
          console.error(
            chalk.redBright(
              `[Queue] ❌ Erro no job [${queue.name}] id=${job.id}`,
            ),
          )
          console.error(err)
        }
      })

      queue.bull.on("failed", (job: Job, err: Error) => {
        console.error(
          chalk.red(`[Queue] 💥 Job falhou [${queue.name}] id=${job.id}`),
        )
        console.error("Data:", job.data)
        console.error("Erro:", err)
      })

      queue.bull.on("ready", () => {
        console.log(
          chalk.blue(`[Queue] ✅ Redis pronto para fila [${queue.name}]`),
        )
      })

      queue.bull.on("error", (err) => {
        console.error(chalk.red(`[Queue] 🟥 Erro na fila [${queue.name}]`), err)
      })

      // 🔔 agenda repeatables aqui
      await ensureRepeatScheduled(queue)
    }

    console.log(chalk.cyanBright("[Queue] 🔧 Queue processor started…"))
  },
}
