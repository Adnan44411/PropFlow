import type { Logger } from 'winston';
import type { Role } from '@propflow/shared';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: { userId: number; tenantId: number | null; role: Role; name?: string; jti: string; exp: number };
      /** Set by tenantScope from the token (never from body or query). */
      tenantId: number;
      validatedQuery?: unknown;
    }
  }
}

export {};
