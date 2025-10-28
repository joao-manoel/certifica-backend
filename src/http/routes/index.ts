import { FastifyInstance } from "fastify"
import { signIn } from "./auth/sign-in"
import { getProfile } from "./auth/get-profile"
import { signUp } from "./auth/sign-up"

export async function routes(app: FastifyInstance) {
  app.register(signIn)
  app.register(getProfile)
  app.register(signUp)
}
