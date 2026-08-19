// ============================================================================
// API error helper — maps errors to the legacy { isOk:false, error } envelope
// without leaking internal details (stack traces, schema, etc.) to clients.
// ============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Auth/session failures (401) — frontend treats these as "log in again". */
export class AuthError extends ApiError {
  constructor(message = "Session expired or invalid") {
    super(message, 401, "AUTH");
    this.name = "AuthError";
  }
}

/** Authorization failures (403). */
export class ForbiddenError extends ApiError {
  constructor(message = "You do not have permission to do that") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

/** Resource not found (404). */
export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/**
 * Convert any thrown value into the legacy API envelope.
 * Internal error messages are scrubbed for 5xx-class errors.
 */
export function toApiResult(err: unknown): { isOk: false; error: string } {
  if (err instanceof ApiError) {
    return { isOk: false, error: err.message };
  }
  // Don't leak internal details for unexpected errors.
  if (process.env.NODE_ENV === "development") {
    return {
      isOk: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
  return { isOk: false, error: "Server error" };
}
