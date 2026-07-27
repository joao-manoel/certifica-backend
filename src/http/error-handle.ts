import type { FastifyInstance } from "fastify"
import { ZodError } from "zod"

import { BadRequestError } from "@/http/_errors/bad-request-error"
import { UnauthorizedError } from "@/http/_errors/unauthorized-error"
import { NotFoundError } from "@/http/_errors/not-found-error"
import { PayloadTooLargeError } from "@/http/_errors/payload-too-large-error"
import { UnsupportedMediaTypeError } from "@/http/_errors/unsupported-media-type-error"

type FastifyErrorHandler = FastifyInstance["errorHandler"]

export const errorHandler: FastifyErrorHandler = (error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: "Validation error",
      errors: error.flatten().fieldErrors,
    })
  }

  if (error instanceof BadRequestError) {
    return reply.status(400).send({
      message: error.message,
    })
  }

  if (error instanceof UnauthorizedError) {
    return reply.status(401).send({
      message: error.message,
    })
  }

  if (error instanceof NotFoundError) {
    return reply.status(404).send({
      message: error.message,
    })
  }

  if (
    error instanceof PayloadTooLargeError ||
    error.code === "FST_REQ_FILE_TOO_LARGE"
  ) {
    return reply.status(413).send({
      message: error.message || "Arquivo excede o limite permitido.",
    })
  }

  if (error instanceof UnsupportedMediaTypeError) {
    return reply.status(415).send({
      message: error.message,
    })
  }

  if (
    error.code === "FST_FILES_LIMIT" ||
    error.code === "FST_FIELDS_LIMIT" ||
    error.code === "FST_PARTS_LIMIT"
  ) {
    return reply.status(400).send({
      message: "Limite de campos ou arquivos excedido.",
    })
  }

  // send error to some observability platform

  return reply.status(500).send({ message: "Internal server error" })
}
