import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { Resource } from "@opentelemetry/resources"
import { SemanticResourceAttributes as S } from "@opentelemetry/semantic-conventions"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http"
import { PrismaInstrumentation } from "@prisma/instrumentation"
import { env } from "@/env"

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const sdk = new NodeSDK({
  resource: new Resource({
    [S.SERVICE_NAME]: "certifica-api",
  }),
  traceExporter: new OTLPTraceExporter({
    url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [new HttpInstrumentation(), new PrismaInstrumentation()],
})

process.on("beforeExit", async () => {
  await sdk.shutdown()
})

export const initializeTracing = async () => {
  return sdk.start()
}
