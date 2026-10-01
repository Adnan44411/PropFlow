import winston from 'winston';
import { requestContext } from './requestContext';

const SENSITIVE_KEY = /pass(word)?|token|authorization|cookie|secret|private|refresh|^rt$/i;
const PHONE = /(?<!\d)(\+?91[\s-]?)?([6-9]\d{4})\d{3}(\d{2})(?!\d)/g;

export function maskPhones(s: string): string {
  return s.replace(PHONE, (_m, _p, a: string, b: string) => `${a}•••${b}`);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return maskPhones(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: maskPhones(value.message), stack: value.stack };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacts secrets, masks phone numbers and stamps the current requestId on every line. */
const scrub = winston.format((info) => {
  const ctx = requestContext.getStore();
  if (ctx?.requestId && !info.requestId) info.requestId = ctx.requestId;
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'timestamp') continue;
    info[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(info[key]);
  }
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  defaultMeta: { service: 'auth-server' },
  format: winston.format.combine(winston.format.timestamp(), scrub(), winston.format.errors({ stack: true }), winston.format.json()),
  transports: [new winston.transports.Console({ silent: process.env.NODE_ENV === 'test' && !process.env.TEST_LOGS })],
});

export type Logger = winston.Logger;
