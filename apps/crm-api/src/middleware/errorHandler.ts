import type { NextFunction, Request, Response } from 'express';
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { zodDetails } from './validate';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/** One error shape everywhere: { error: { code, message, details? } } */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (err instanceof ZodError) appErr = new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', zodDetails(err));
  else if (err instanceof UniqueConstraintError) appErr = new AppError(409, 'CONFLICT', 'Duplicate value', { fields: err.fields });
  else if (err instanceof SequelizeValidationError) appErr = new AppError(400, 'VALIDATION_ERROR', err.message);
  else if (err instanceof SyntaxError && 'body' in (err as object)) appErr = new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body');
  else if ((err as { type?: string })?.type === 'entity.too.large') appErr = new AppError(413 as number, 'VALIDATION_ERROR', 'Request body too large');
  else {
    (req.log ?? logger).error('unhandled error', { err });
    appErr = new AppError(500, 'INTERNAL', 'Something went wrong');
  }
  if (appErr.status >= 500 && err instanceof AppError) (req.log ?? logger).error('server error', { err });
  if (appErr.headers) for (const [k, v] of Object.entries(appErr.headers)) res.setHeader(k, v);
  const body: { error: { code: string; message: string; details?: unknown; requestId?: string } } = {
    error: { code: appErr.code, message: appErr.message },
  };
  if (appErr.details !== undefined) body.error.details = appErr.details;
  res.status(appErr.status).json(body);
}
