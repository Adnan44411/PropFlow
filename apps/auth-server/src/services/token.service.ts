import crypto from 'node:crypto';
import jwt, { JwtHeader, JwtPayload } from 'jsonwebtoken';
import type { AccessTokenClaims, Role } from '@propflow/shared';
import { config } from '../config';
import { Errors } from '../lib/errors';
import { keyStore } from '../keys/keyStore';

export interface TokenSubject {
  id: number;
  tenantId: number | null;
  role: Role;
  name: string;
}

export function issueAccessToken(user: TokenSubject): { accessToken: string; expiresIn: number; jti: string } {
  const { kid, privateKey } = keyStore.signingKey();
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign({ tid: user.tenantId, role: user.role, name: user.name }, privateKey, {
    algorithm: 'RS256',
    keyid: kid,
    subject: String(user.id),
    jwtid: jti,
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
  });
  return { accessToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS, jti };
}

function keyFromHeader(header: JwtHeader) {
  if (header.alg !== 'RS256' || !header.kid) throw Errors.invalidToken('Unsupported token header');
  const key = keyStore.publicKeyFor(header.kid);
  if (!key) throw Errors.invalidToken('Unknown signing key');
  return key;
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw Errors.invalidToken();
  const key = keyFromHeader(decoded.header);
  try {
    const payload = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }) as JwtPayload & AccessTokenClaims;
    if ((payload as { typ?: string }).typ) throw Errors.invalidToken('Not an access token');
    return payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.tokenExpired();
    if (err instanceof Error && err.name === 'AppError') throw err;
    throw Errors.invalidToken();
  }
}

/** Invite links are RS256-signed (typ=invite, jti=invite id) and single-use via the DB. */
export function signInviteToken(payload: { inviteId: number; tenantId: number; email: string; role: Role }): string {
  const { kid, privateKey } = keyStore.signingKey();
  return jwt.sign({ typ: 'invite', tid: payload.tenantId, email: payload.email, role: payload.role }, privateKey, {
    algorithm: 'RS256',
    keyid: kid,
    jwtid: String(payload.inviteId),
    issuer: config.JWT_ISSUER,
    audience: `${config.JWT_AUDIENCE}:invite`,
    expiresIn: config.INVITE_TTL_SECONDS,
  });
}

export function verifyInviteToken(token: string): { inviteId: number; tenantId: number; email: string } {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw Errors.rule('INVITE_INVALID', 'Invite link is invalid');
  const key = decoded.header.kid ? keyStore.publicKeyFor(decoded.header.kid) : null;
  if (!key) throw Errors.rule('INVITE_INVALID', 'Invite link is invalid or has expired');
  try {
    const p = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: config.JWT_ISSUER,
      audience: `${config.JWT_AUDIENCE}:invite`,
    }) as JwtPayload & { typ: string; tid: number; email: string };
    if (p.typ !== 'invite' || !p.jti) throw new Error('bad typ');
    return { inviteId: Number(p.jti), tenantId: p.tid, email: p.email };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.rule('INVITE_INVALID', 'Invite link has expired');
    throw Errors.rule('INVITE_INVALID', 'Invite link is invalid');
  }
}
