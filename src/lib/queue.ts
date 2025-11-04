import Queue, { Job, JobOptions, Queue as QueueType } from "bull"
import * as jobs from "@/queue/jobs"
import { env } from "@/env"

// opcional: usar cores pra facilitar leitura
import chalk from "chalk"

interface JobData {
  key: string
  handle: (job: Job) => Promise<void>
  options?: JobOptions
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
  })

  return {
    bull: q,
    name: job.key,
    handle: job.handle,
    options: job.options,
  }
})

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

  process() {
    console.log(
      chalk.cyanBright("[Queue] 🧠 Iniciando processamento das filas..."),
    )

    return this.queues.forEach((queue) => {
      queue.bull.process(async (job: Job) => {
        const start = performance.now()
        console.log(
          chalk.greenBright(
            `[Queue] ▶️ Job iniciado [${queue.name}] id=${job.id}`,
          ),
        )
        console.log(chalk.gray(`       Payload:`), job.data)

        try {
          await queue.handle(job)
          const duration = (performance.now() - start).toFixed(1)
          console.log(
            chalk.greenBright(
              `[Queue] ✅ Job concluído [${queue.name}] id=${job.id} (${duration}ms)`,
            ),
          )
        } catch (err) {
          console.error(
            chalk.redBright(
              `[Queue] ❌ Erro no job [${queue.name}] id=${job.id}`,
            ),
          )
          console.error(err)
        }
      })

      queue.bull.on("completed", (job: Job) => {
        console.log(
          chalk.green(`[Queue] 🏁 Job finalizado [${queue.name}] id=${job.id}`),
        )
      })

      queue.bull.on("failed", (job: Job, err: Error) => {
        console.error(
          chalk.red(`[Queue] 💥 Job falhou [${queue.name}] id=${job.id}`),
        )
        console.error("Data:", job.data)
        console.error("Erro:", err)
      })

      queue.bull.on("stalled", (job: Job) => {
        console.warn(
          chalk.yellow(`[Queue] ⚠️ Job travado [${queue.name}] id=${job.id}`),
        )
      })

      queue.bull.on("active", (job: Job) => {
        console.log(
          chalk.blue(`[Queue] 🔄 Executando job [${queue.name}] id=${job.id}`),
        )
      })

      queue.bull.on("waiting", (jobId) => {
        console.log(
          chalk.gray(`[Queue] ⏳ Job aguardando [${queue.name}] id=${jobId}`),
        )
      })
    })
  },
}
