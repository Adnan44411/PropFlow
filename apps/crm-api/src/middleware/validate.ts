import type { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { Errors } from '../lib/errors';

/** Converts a ZodError into { fields: { path: message }, issues: [...] } so the UI can map errors to inputs. */
export function zodDetails(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return { fields, issues: err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })) };
}

type Source = 'body' | 'query' | 'params';

/** validate(schema, 'body') — parses with the shared Zod schema and replaces req[source] with the parsed value. */
export const validate =
  (schema: ZodTypeAny, source: Source = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(Errors.validation(zodDetails(result.error)));
    if (source === 'query') req.validatedQuery = result.data;
    else (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
