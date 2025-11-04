import { env } from "@/env"
import nodemailer from "nodemailer"

export const Mail = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: env.NODEMAILER_USER,
    pass: env.NODEMAILER_PASSWORD,
  },
})

// Verifica se as configurações estão corretas
Mail.verify((error) => {
  if (error) {
    console.error("Erro ao conectar com o serviço de email:", error)
  } else {
    console.log("Conectado ao serviço de email com sucesso!")
  }
})
