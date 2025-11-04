import Queue, { Job, JobOptions, Queue as QueueType } from "bull"

import * as jobs from "@/queue/jobs"
import { env } from "@/env"

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

const queues: QueueData[] = Object.values(jobs).map((job: JobData) => ({
  bull: new Queue(job.key, {
    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
  }),
  name: job.key,
  handle: job.handle,
  options: job.options,
}))
export default {
  queues,

  add<T extends object>(name: string, data: T) {
    const queue = this.queues.find((queue) => queue.name === name)

    if (!queue) {
      throw new Error(`Queue with name ${name} not found`)
    }

    return queue.bull.add(data, queue.options)
  },

  process() {
    return this.queues.forEach((queue) => {
      queue.bull.process(queue.handle)

      queue.bull.on("failed", (job: Job, err: Error) => {
        console.log("Job failed", queue.name, job.data)
        console.log(err)
      })
    })
  },
}
