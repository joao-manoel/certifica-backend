import type { FastifyInstance } from "fastify"
import type { ZodTypeProvider } from "fastify-type-provider-zod"
import { z } from "zod"

import {
  editorContentSchema,
  validatePostManifest,
} from "@/utils/editor-content"
import { auth } from "@/http/middlewares/auth"

export async function validatePost(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().register(auth).post(
    "/blog/admin/posts/validate",
    {
      schema: {
        tags: ["Posts"],
        summary: "Validate a post manifest before saving",
        body: z.object({
          title: z.string().min(1).max(160),
          excerpt: z.string().max(300).optional().nullable(),
          seoTitle: z.string().max(60).optional().nullable(),
          metaDescription: z.string().max(160).optional().nullable(),
          focusKeyword: z.string().max(160).optional().nullable(),
          content: editorContentSchema,
          coverId: z.string().uuid().optional().nullable(),
        }),
        response: {
          200: z.object({
            valid: z.boolean(),
            errors: z.array(z.string()),
            warnings: z.array(z.string()),
            stats: z.object({
              images: z.number().int(),
              words: z.number().int(),
            }),
          }),
        },
      },
      preHandler: async (request) => {
        await request.requireScopes(["posts:write"])
      },
    },
    async (request, reply) => {
      return reply.send(validatePostManifest(request.body))
    },
  )
}
