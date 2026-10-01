import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../lib/errors';

/**
 * The refresh cookie is SameSite=None (web and API are on different sites), so cookie-authenticated
 * endpoints additionally require the browser's Origin to be the web app (CSRF defence).
 * Non-browser clients (curl, tests) send no Origin and are allowed.
 */
export function cookieOriginCheck(req: Request, _res: Response, next: NextFunction) {
  const origin = req.header('origin');
  if (origin && !config.webOrigins.includes(origin)) {
    return next(new AppError(403, 'FORBIDDEN_ORIGIN', 'Origin not allowed'));
  }
  next();
}
