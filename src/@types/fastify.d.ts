import "fastify"

export type EditorScope =
  | "posts:read"
  | "posts:write"
  | "posts:publish"
  | "media:read"
  | "media:write"

export type EditorContext = {
  userId: string
  apiClientId: string | null
  scopes: EditorScope[]
  kind: "user" | "integration"
}

declare module "fastify" {
  export interface FastifyRequest {
    getCurrentUserId(): Promise<string>
    getEditorContext(): Promise<EditorContext>
    requireScopes(scopes: EditorScope[]): Promise<EditorContext>
  }
}
