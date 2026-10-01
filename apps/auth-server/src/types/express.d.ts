import type { Logger } from 'winston';
import type { Role } from '@propflow/shared';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      auth?: { userId: number; tenantId: number | null; role: Role; name?: string; jti: string };
      validatedQuery?: unknown;
    }
  }
}

export {};
