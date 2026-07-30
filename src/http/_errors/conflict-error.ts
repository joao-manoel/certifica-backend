export class ConflictError extends Error {
  details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.details = details
  }
}
