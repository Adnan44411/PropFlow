import type { ErrorCode } from '@propflow/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (details: unknown, message = 'Request validation failed') => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', 'Access token expired'),
  invalidToken: (message = 'Invalid access token') => new AppError(401, 'INVALID_TOKEN', message),
  forbiddenRole: (message = 'Your role does not allow this action') => new AppError(403, 'FORBIDDEN_ROLE', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: ErrorCode, message: string, details?: unknown) => new AppError(409, code, message, details),
  rule: (code: ErrorCode, message: string, details?: unknown) => new AppError(422, code, message, details),
};
