import { FastifyInstance } from "fastify"
import { signIn } from "./auth/sign-in"
import { getProfile } from "./auth/get-profile"
import { signUp } from "./auth/sign-up"
import { updateUser } from "./user/update-user"
import { updateUserPassword } from "./user/update-user-password"

export async function routes(app: FastifyInstance) {
  app.register(signIn)
  app.register(getProfile)
  app.register(signUp)
  app.register(updateUser)
  app.register(updateUserPassword)
}
