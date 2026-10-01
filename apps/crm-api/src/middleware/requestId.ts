import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { requestContext } from '../lib/requestContext';

const VALID = /^[A-Za-z0-9._:-]{8,64}$/;

/** Accept X-Request-Id (if sane) or generate one; attach a child logger; log one access line. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  req.log = logger.child({ requestId: id });
  res.setHeader('X-Request-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (req.path === '/health') return;
    req.log[res.statusCode >= 500 ? 'error' : 'info']('http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      userId: req.auth?.userId,
      tenantId: req.auth?.tenantId,
      ip: req.ip,
    });
  });
  requestContext.run({ requestId: id }, () => next());
}
