/** Every error response from both services has exactly this shape. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export const ERROR_CODES = [
  'VALIDATION_ERROR', // 400
  'UNAUTHENTICATED', // 401 missing token
  'TOKEN_EXPIRED', // 401
  'INVALID_TOKEN', // 401
  'INVALID_CREDENTIALS', // 401
  'REFRESH_INVALID', // 401
  'REFRESH_REUSED', // 401 reuse detected, family revoked
  'FORBIDDEN_ROLE', // 403
  'FORBIDDEN_ORIGIN', // 403 cookie endpoint called from a foreign origin
  'NOT_FOUND', // 404
  'VERSION_CONFLICT', // 409
  'DUPLICATE_LISTING', // 409
  'CONFLICT', // 409 generic unique violation
  'EMAIL_TAKEN', // 409
  'SLUG_TAKEN', // 409
  'BUSINESS_RULE', // 422 generic
  'LAST_ADMIN', // 422
  'IN_USE', // 422
  'TERMINAL_STATUS', // 422
  'INVITE_INVALID', // 422
  'ACCOUNT_DISABLED', // 403
  'RATE_LIMITED', // 429
  'INTERNAL', // 500
  'SERVICE_UNAVAILABLE', // 503
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
