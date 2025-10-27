import fastifyJwt from "@fastify/jwt"
import fastify from "fastify"
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod"
import { errorHandler } from "@/http/error-handle"
import { env } from "@/env"
import { routes } from "@/http/routes"
import fastifyMultipart, {
  type FastifyMultipartOptions,
} from "@fastify/multipart"
import fastifyStatic from "@fastify/static"
import fastifyCors from "@fastify/cors"
import path from "path"

// Configurações do servidor
const app = fastify({
  //logger: true,
  bodyLimit: 15 * 1024 * 1024, // 15MB
  connectionTimeout: 60000, // 60 segundos
  keepAliveTimeout: 60000, // 60 segundos
}).withTypeProvider<ZodTypeProvider>()

app.register(fastifyCors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
})

app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/",
})

export const multipartConfig: FastifyMultipartOptions = {
  limits: {
    fileSize: 25 * 1024 * 1024, // Limite de 25MB por arquivo
    files: 5, // Até 5 arquivos por requisição (ajuste se quiser)
  },
  attachFieldsToBody: false, // Garante que os fields sejam acessados apenas via parts()
}

app.setSerializerCompiler(serializerCompiler)
app.setValidatorCompiler(validatorCompiler)
app.setErrorHandler(errorHandler)

app.register(fastifyMultipart, multipartConfig)

app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
})

app.register(routes)

app
  .listen({
    port: env.PORT,
    host: "0.0.0.0", // Importante para garantir que o servidor aceite conexões de qualquer origem
  })
  .then(() => {
    console.log(`🔥 Server listening on ${env.PORT}`)
  })
