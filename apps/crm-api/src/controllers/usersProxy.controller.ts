import type { Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../lib/errors';

/**
 * /users and /invites live in auth_db (identity is owned by auth-server; the services must not
 * share a database). crm-api exposes them for the web app by forwarding the caller's bearer
 * token; auth-server re-checks the role and tenant itself.
 */
export async function proxyToAuth(req: Request, res: Response) {
  const url = `${config.AUTH_SERVER_URL.replace(/\/$/, '')}${req.originalUrl}`;
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: {
        authorization: req.header('authorization') ?? '',
        'content-type': 'application/json',
        'x-request-id': req.id,
        'x-forwarded-for': req.ip ?? '',
      },
      body: ['GET', 'HEAD', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Identity service is unavailable', { reason: (err as Error).message });
  }
  res.status(upstream.status);
  const type = upstream.headers.get('content-type');
  if (type) res.setHeader('Content-Type', type);
  if (upstream.status === 204) return res.end();
  res.send(Buffer.from(await upstream.arrayBuffer()));
}
