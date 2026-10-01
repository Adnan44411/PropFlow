import jwt, { JwtPayload } from 'jsonwebtoken';
import type { AccessTokenClaims } from '@propflow/shared';
import { config } from '../config';
import { Errors } from '../lib/errors';
import { jwksClient } from '../lib/jwks';

export interface AuthContext {
  userId: number;
  tenantId: number | null;
  role: AccessTokenClaims['role'];
  name?: string;
  jti: string;
  exp: number;
}

/** RS256 only, issuer + audience checked, key looked up by `kid` from the auth-server JWKS. */
export async function verifyAccessToken(token: string): Promise<AuthContext> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') throw Errors.invalidToken();
  if (decoded.header.alg !== 'RS256' || !decoded.header.kid) throw Errors.invalidToken('Unsupported token algorithm');
  const key = await jwksClient.getKey(decoded.header.kid);
  if (!key) throw Errors.invalidToken('Unknown signing key');
  try {
    const p = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    }) as JwtPayload & AccessTokenClaims;
    return { userId: Number(p.sub), tenantId: p.tid ?? null, role: p.role, name: p.name, jti: p.jti, exp: p.exp };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.tokenExpired();
    throw Errors.invalidToken();
  }
}
