/**
 * API errors. Every error response has the shape
 *   { "error": { "code": "SOME_CODE", "message": "Human readable", "details"?: … } }
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required: send "Authorization: Bearer <token>".') => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message: string, details?: unknown) => new ApiError(403, 'FORBIDDEN', message, details);
export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) => new ApiError(422, code, message, details);

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorBody(code: string, message: string, details?: unknown): ErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
