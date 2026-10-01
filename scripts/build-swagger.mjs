#!/usr/bin/env node
/**
 * Generates the OpenAPI 3.0.3 documents:
 *   apps/auth-server/swagger.json   (served at auth-server /docs and /swagger.json)
 *   apps/crm-api/swagger.json       (served at crm-api /docs and /swagger.json)
 *   swagger.json                    (both services in one file, per-path `servers`)
 *
 * Kept as code so shared components (error shape, pagination, security) are written once.
 * Run: npm run swagger:build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const AUTH_URL_LOCAL = 'http://localhost:4000';
const CRM_URL_LOCAL = 'http://localhost:4001';
const AUTH_URL_PROD = 'https://propflow-auth.up.railway.app';
const CRM_URL_PROD = 'https://propflow-crm.up.railway.app';

// ─────────────────────────────── helpers ───────────────────────────────

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const resp = (name) => ({ $ref: `#/components/responses/${name}` });
const param = (name) => ({ $ref: `#/components/parameters/${name}` });
const json = (schema, example) => ({ 'application/json': { schema, ...(example !== undefined ? { example } : {}) } });
const ok = (description, schema, example, headers) => ({ description, content: json(schema, example), ...(headers ? { headers } : {}) });
const body = (schema, example, description) => ({ required: true, ...(description ? { description } : {}), content: json(schema, example) });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
// OAS 3.0: `nullable` needs a sibling `type`, so wrap $refs in allOf.
const nullable = (schema) => (schema.$ref ? { type: 'object', nullable: true, allOf: [schema] } : { ...schema, nullable: true });
const obj = (properties, required = [], extra = {}) => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...extra });
const idPath = (description = 'Numeric id') => ({ name: 'id', in: 'path', required: true, description, schema: { type: 'integer', minimum: 1 } });
const bearer = [{ bearerAuth: [] }];

const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'INVALID_TOKEN',
  'INVALID_CREDENTIALS',
  'REFRESH_INVALID',
  'REFRESH_REUSED',
  'FORBIDDEN_ROLE',
  'FORBIDDEN_ORIGIN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'DUPLICATE_LISTING',
  'CONFLICT',
  'EMAIL_TAKEN',
  'SLUG_TAKEN',
  'BUSINESS_RULE',
  'LAST_ADMIN',
  'IN_USE',
  'TERMINAL_STATUS',
  'INVITE_INVALID',
  'ACCOUNT_DISABLED',
  'RATE_LIMITED',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
];

const errorExample = (code, message, details) => ({ error: { code, message, ...(details !== undefined ? { details } : {}) } });

// ─────────────────────────────── shared components ───────────────────────────────

const sharedSchemas = {
  Error: {
    type: 'object',
    description: 'The one error shape returned by both services for every non-2xx response.',
    required: ['error'],
    properties: {
      error: obj(
        {
          code: { type: 'string', enum: ERROR_CODES, description: 'Stable machine-readable code' },
          message: { type: 'string', description: 'Human-readable message (safe to show in the UI)' },
          details: {
            description:
              'Optional, code-specific. For VALIDATION_ERROR it is `ValidationErrorDetails`; for VERSION_CONFLICT it carries the current server copy.',
            anyOf: [ref('ValidationErrorDetails'), { type: 'object', additionalProperties: true }],
          },
        },
        ['code', 'message'],
      ),
    },
  },
  ValidationErrorDetails: obj(
    {
      fields: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Field path → first error message. The web app maps these onto react-hook-form inputs.',
        example: { priceInr: 'Price must be greater than 0', ownerPhone: 'Enter a valid 10-digit Indian mobile number' },
      },
      issues: arr(obj({ path: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' } })),
    },
    ['fields'],
  ),
  Role: { type: 'string', enum: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'AGENT'] },
  TenantRole: { type: 'string', enum: ['ADMIN', 'MANAGER', 'AGENT'] },
  HealthCheck: obj(
    {
      status: { type: 'string', enum: ['up', 'down'] },
      latencyMs: { type: 'integer' },
      error: { type: 'string' },
    },
    ['status'],
  ),
};

const sharedResponses = {
  BadRequest: {
    description: '400 — request failed validation against the shared Zod schema',
    content: json(
      ref('Error'),
      errorExample('VALIDATION_ERROR', 'Request validation failed', {
        fields: { email: 'Invalid email' },
        issues: [{ path: 'email', code: 'invalid_string', message: 'Invalid email' }],
      }),
    ),
  },
  Unauthorized: {
    description: '401 — missing, invalid or expired access token',
    content: {
      'application/json': {
        schema: ref('Error'),
        examples: {
          missing: { value: errorExample('UNAUTHENTICATED', 'Authentication required') },
          expired: { summary: 'Access token expired → client calls /auth/refresh and retries', value: errorExample('TOKEN_EXPIRED', 'Access token expired') },
          invalid: { value: errorExample('INVALID_TOKEN', 'Invalid access token') },
        },
      },
    },
  },
  Forbidden: {
    description: '403 — authenticated, but the role may not do this',
    content: json(ref('Error'), errorExample('FORBIDDEN_ROLE', 'Your role does not allow this action')),
  },
  NotFound: {
    description: '404 — does not exist, belongs to another tenant, or (for an AGENT) is not assigned to you. These cases are deliberately indistinguishable.',
    content: json(ref('Error'), errorExample('NOT_FOUND', 'Property not found')),
  },
  Unprocessable: {
    description: '422 — a business rule was violated',
    content: json(ref('Error'), errorExample('BUSINESS_RULE', 'Some listings were not found; nothing was changed', { missingIds: [999999] })),
  },
  TooManyRequests: {
    description: '429 — rate limited',
    headers: { 'Retry-After': { description: 'Seconds until the lockout ends', schema: { type: 'integer', example: 897 } } },
    content: json(ref('Error'), errorExample('RATE_LIMITED', 'Too many failed attempts. Try again in 15 min.', { retryAfter: 897 })),
  },
  ServiceUnavailable: {
    description: '503 — a dependency is down',
    content: json(ref('Error'), errorExample('SERVICE_UNAVAILABLE', 'Identity service is unavailable')),
  },
};

const sharedParameters = {
  XRequestId: {
    name: 'X-Request-Id',
    in: 'header',
    required: false,
    description:
      'Optional correlation id (8–64 chars `[A-Za-z0-9._:-]`). Generated when absent and echoed back in the response header; appears on every log line.',
    schema: { type: 'string', example: 'web-7f3a9c21' },
  },
};

const sharedHeaders = {
  'X-Request-Id': { description: 'Correlation id for this request (search logs with it)', schema: { type: 'string', format: 'uuid' } },
};

const securitySchemes = {
  bearerAuth: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT (RS256)',
    description:
      'Access token from `/auth/login`, `/auth/refresh`, `/auth/register-tenant` or `/auth/accept-invite`. RS256, header carries `kid`; claims `sub`, `tid`, `role`, `name`, `jti`, `iat`, `exp`, `iss=propflow-auth`, `aud=propflow`. 60 s lifetime in the deployed build. Keep it in memory only.',
  },
  refreshCookie: {
    type: 'apiKey',
    in: 'cookie',
    name: 'pf_rt',
    description:
      'Opaque 256-bit rotating refresh token (7 days). httpOnly; Secure; SameSite=None (web and API are on different sites); Path=/auth. Stored in Redis only as SHA-256. Never sent in a JSON body.',
  },
};

// ─────────────────────────────── auth-server ───────────────────────────────

const exUser = {
  id: 3,
  tenantId: 1,
  email: 'manager@skyline.dev',
  name: 'Neha Kapoor',
  role: 'MANAGER',
  isActive: true,
  lastLoginAt: '2026-10-01T04:31:10.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
};
const exSession = {
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IkRBMHBXc0xTM1lJc294UUtUUkRpR09NSkNLVDZMSnEtIn0.eyJ0aWQiOjEsInJvbGUiOiJNQU5BR0VSIi4uLn0.sig',
  tokenType: 'Bearer',
  expiresIn: 60,
  user: exUser,
  tenant: { id: 1, name: 'Skyline Realty', slug: 'skyline' },
};
const setCookieHeader = {
  'Set-Cookie': {
    description: 'Rotating refresh token: `pf_rt=<opaque>; Path=/auth; HttpOnly; Secure; SameSite=None; Max-Age=604800`',
    schema: { type: 'string', example: 'pf_rt=q4x…; Path=/auth; Expires=Thu, 08 Oct 2026 04:31:10 GMT; HttpOnly; Secure; SameSite=None' },
  },
  'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' },
};

const authSchemas = {
  ...sharedSchemas,
  PublicUser: obj(
    {
      id: { type: 'integer', example: 3 },
      tenantId: nullable({ type: 'integer', example: 1, description: 'null for SUPER_ADMIN' }),
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      role: ref('Role'),
      isActive: { type: 'boolean' },
      lastLoginAt: nullable({ type: 'string', format: 'date-time' }),
      createdAt: { type: 'string', format: 'date-time' },
    },
    ['id', 'tenantId', 'email', 'name', 'role', 'isActive'],
    { example: exUser },
  ),
  TenantRef: obj({ id: { type: 'integer' }, name: { type: 'string' }, slug: { type: 'string' } }, ['id', 'name', 'slug']),
  SessionResponse: obj(
    {
      accessToken: { type: 'string', description: 'RS256 JWT, 60 s' },
      tokenType: { type: 'string', enum: ['Bearer'] },
      expiresIn: { type: 'integer', description: 'Seconds', example: 60 },
      user: ref('PublicUser'),
      tenant: nullable(ref('TenantRef')),
    },
    ['accessToken', 'tokenType', 'expiresIn', 'user', 'tenant'],
    { example: exSession },
  ),
  LoginRequest: obj(
    { email: { type: 'string', format: 'email', maxLength: 190 }, password: { type: 'string', minLength: 1, maxLength: 128 } },
    ['email', 'password'],
    { example: { email: 'manager@skyline.dev', password: 'PropFlow@123' } },
  ),
  RegisterTenantRequest: obj(
    {
      companyName: { type: 'string', minLength: 2, maxLength: 120 },
      slug: { type: 'string', minLength: 3, maxLength: 60, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
      adminName: { type: 'string', minLength: 2, maxLength: 120 },
      adminEmail: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128, description: 'At least 8 chars with a letter and a digit' },
    },
    ['companyName', 'slug', 'adminName', 'adminEmail', 'password'],
    {
      example: {
        companyName: 'Coastline Properties',
        slug: 'coastline',
        adminName: 'Anita Desai',
        adminEmail: 'anita@coastline.in',
        password: 'Coastline2026',
      },
    },
  ),
  InviteRequest: obj(
    { email: { type: 'string', format: 'email' }, name: { type: 'string', minLength: 2, maxLength: 120 }, role: ref('TenantRole') },
    ['email', 'name', 'role'],
    { example: { email: 'rahul@skyline.dev', name: 'Rahul Verma', role: 'AGENT' } },
  ),
  Invite: obj({
    id: { type: 'integer' },
    tenantId: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    role: ref('TenantRole'),
    invitedBy: nullable({ type: 'integer' }),
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: nullable({ type: 'string', format: 'date-time' }),
    revokedAt: nullable({ type: 'string', format: 'date-time' }),
    state: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] },
    createdAt: { type: 'string', format: 'date-time' },
  }),
  InviteResponse: obj(
    {
      invite: ref('Invite'),
      inviteUrl: { type: 'string', format: 'uri', description: 'Signed, single-use, 24 h. Also written to the logs (no real email is sent).' },
      inviteToken: { type: 'string', description: 'RS256 JWT (typ=invite, aud=propflow:invite, jti=invite id)' },
    },
    ['invite', 'inviteUrl', 'inviteToken'],
    {
      example: {
        invite: {
          id: 12,
          tenantId: 1,
          email: 'rahul@skyline.dev',
          name: 'Rahul Verma',
          role: 'AGENT',
          invitedBy: 2,
          expiresAt: '2026-10-02T04:31:10.000Z',
          acceptedAt: null,
          revokedAt: null,
          state: 'PENDING',
          createdAt: '2026-10-01T04:31:10.000Z',
        },
        inviteUrl: 'https://propflow-yourname.web.app/accept-invite?token=eyJhbGciOiJSUzI1NiIs…',
        inviteToken: 'eyJhbGciOiJSUzI1NiIs…',
      },
    },
  ),
  InviteInfo: obj({
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    role: ref('TenantRole'),
    tenant: nullable(ref('TenantRef')),
    expiresAt: { type: 'string', format: 'date-time' },
  }),
  AcceptInviteRequest: obj(
    {
      token: { type: 'string', minLength: 20, description: 'The `token` query parameter of the invite link' },
      name: { type: 'string', minLength: 2, maxLength: 120, description: 'Overrides the name the admin typed' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
    },
    ['token', 'password'],
    { example: { token: 'eyJhbGciOiJSUzI1NiIs…', password: 'Welcome2026' } },
  ),
  UpdateUserRequest: obj({ role: ref('TenantRole'), isActive: { type: 'boolean' }, name: { type: 'string', minLength: 2, maxLength: 120 } }, [], {
    minProperties: 1,
    example: { role: 'MANAGER' },
  }),
  TenantSummary: obj(
    {
      id: { type: 'integer' },
      name: { type: 'string' },
      slug: { type: 'string' },
      isActive: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      userCount: { type: 'integer' },
      activeUserCount: { type: 'integer' },
      usersByRole: obj({ ADMIN: { type: 'integer' }, MANAGER: { type: 'integer' }, AGENT: { type: 'integer' } }),
      pendingInvites: { type: 'integer' },
    },
    [],
    {
      example: {
        id: 1,
        name: 'Skyline Realty',
        slug: 'skyline',
        isActive: true,
        createdAt: '2026-09-01T10:00:00.000Z',
        userCount: 4,
        activeUserCount: 4,
        usersByRole: { ADMIN: 1, MANAGER: 1, AGENT: 2 },
        pendingInvites: 0,
      },
    },
  ),
  CreateTenantRequest: obj(
    {
      companyName: { type: 'string', minLength: 2, maxLength: 120 },
      slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', minLength: 3, maxLength: 60 },
      adminName: { type: 'string', minLength: 2, maxLength: 120 },
      adminEmail: { type: 'string', format: 'email' },
    },
    ['companyName', 'slug', 'adminName', 'adminEmail'],
    { example: { companyName: 'Metro Nest', slug: 'metro-nest', adminName: 'Kiran Rao', adminEmail: 'kiran@metronest.in' } },
  ),
  CreateTenantResponse: {
    allOf: [
      obj({
        tenant: obj({
          id: { type: 'integer' },
          name: { type: 'string' },
          slug: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        }),
      }),
      ref('InviteResponse'),
    ],
  },
  SecurityEvent: obj(
    {
      id: { type: 'integer' },
      type: {
        type: 'string',
        enum: [
          'LOGIN_SUCCESS',
          'LOGIN_FAILED',
          'LOGIN_LOCKED',
          'REFRESH_REUSE_DETECTED',
          'LOGOUT',
          'LOGOUT_ALL',
          'KEY_ROTATED',
          'TENANT_CREATED',
          'INVITE_CREATED',
          'INVITE_ACCEPTED',
          'USER_UPDATED',
        ],
      },
      severity: { type: 'string', enum: ['INFO', 'WARN', 'CRITICAL'] },
      userId: nullable({ type: 'integer' }),
      tenantId: nullable({ type: 'integer' }),
      ip: nullable({ type: 'string' }),
      userAgent: nullable({ type: 'string' }),
      requestId: nullable({ type: 'string' }),
      meta: nullable({ type: 'object', additionalProperties: true }),
      createdAt: { type: 'string', format: 'date-time' },
    },
    [],
    {
      example: {
        id: 88,
        type: 'REFRESH_REUSE_DETECTED',
        severity: 'CRITICAL',
        userId: 3,
        tenantId: 1,
        ip: '49.36.10.4',
        userAgent: 'Mozilla/5.0',
        requestId: '1d0f…',
        meta: { familyId: '6b1c…', revokedTokens: 2 },
        createdAt: '2026-10-01T05:02:44.000Z',
      },
    },
  ),
  SigningKeyInfo: obj({
    kid: { type: 'string', description: 'RFC 7638 thumbprint (truncated)' },
    alg: { type: 'string', enum: ['RS256'] },
    source: {
      type: 'string',
      enum: ['env', 'rotated'],
      description: '`env` = bootstrap key from JWT_PRIVATE_KEY; `rotated` = created by /admin/rotate-keys and stored AES-256-GCM encrypted',
    },
    createdAt: { type: 'string', format: 'date-time' },
    retiredAt: nullable({ type: 'string', format: 'date-time' }),
    signing: { type: 'boolean', description: 'true for the key currently signing new tokens' },
    publishedUntil: nullable({
      type: 'string',
      format: 'date-time',
      description: 'Retired keys stay in JWKS until their tokens (and invite links) have expired',
    }),
  }),
  Jwk: obj(
    {
      kty: { type: 'string', enum: ['RSA'] },
      kid: { type: 'string' },
      alg: { type: 'string', enum: ['RS256'] },
      use: { type: 'string', enum: ['sig'] },
      n: { type: 'string' },
      e: { type: 'string' },
    },
    ['kty', 'kid', 'alg', 'use', 'n', 'e'],
  ),
  Jwks: obj({ keys: arr(ref('Jwk')) }, ['keys'], {
    example: {
      keys: [
        { kty: 'RSA', kid: 'q2V0dGhpc2lzYW5ld2tleWlkMDAwMDE', alg: 'RS256', use: 'sig', n: '0SceKp6N1YXu…', e: 'AQAB' },
        { kty: 'RSA', kid: 'DA0pWsLS3YIsoxQKTRDiGOMJCKT6LJq-', alg: 'RS256', use: 'sig', n: 'u8x0…', e: 'AQAB' },
      ],
    },
  }),
  AuthHealth: obj({
    status: { type: 'string', enum: ['ok', 'degraded'] },
    service: { type: 'string', example: 'auth-server' },
    version: { type: 'string' },
    uptimeSeconds: { type: 'integer' },
    checks: obj({
      mysql: ref('HealthCheck'),
      redis: ref('HealthCheck'),
      signingKeys: obj({ status: { type: 'string', enum: ['up', 'down'] }, published: { type: 'integer' } }),
    }),
  }),
};

const authPaths = {
  '/health': {
    get: {
      tags: ['System'],
      summary: 'Liveness + MySQL + Redis',
      description: 'Public. 200 when MySQL, Redis and at least one signing key are available, otherwise 503. Used by the Docker HEALTHCHECK and Railway.',
      operationId: 'authHealth',
      responses: {
        200: ok('Healthy', ref('AuthHealth'), {
          status: 'ok',
          service: 'auth-server',
          version: '1.0.0',
          uptimeSeconds: 5231,
          checks: { mysql: { status: 'up', latencyMs: 3 }, redis: { status: 'up', latencyMs: 1 }, signingKeys: { status: 'up', published: 2 } },
        }),
        503: ok('A dependency is down', ref('AuthHealth')),
      },
    },
  },
  '/.well-known/jwks.json': {
    get: {
      tags: ['System'],
      summary: 'Public signing keys (JWKS)',
      description:
        'Every key that can still verify a live token: the current signing key plus retired keys during their grace period (so crm-api keeps accepting tokens across a rotation without a restart). `Cache-Control: public, max-age=300`. crm-api caches it in Redis (`jwks`, 10 min) and refetches on an unknown `kid`.',
      operationId: 'jwks',
      responses: {
        200: {
          description: 'JWK Set',
          headers: { 'Cache-Control': { schema: { type: 'string', example: 'public, max-age=300, stale-while-revalidate=60' } } },
          content: json(ref('Jwks')),
        },
      },
    },
  },
  '/auth/register-tenant': {
    post: {
      tags: ['Auth'],
      summary: 'Public sign-up: create a tenant and its first ADMIN',
      description:
        'Tenant + ADMIN user are created in one DB transaction, then the admin is logged in (same response as `/auth/login`). crm-api receives a `tenant.created` event and provisions the default status pipeline, property types and amenities.',
      operationId: 'registerTenant',
      requestBody: body(ref('RegisterTenantRequest')),
      responses: {
        201: { description: 'Tenant created, admin logged in', headers: setCookieHeader, content: json(ref('SessionResponse')) },
        400: resp('BadRequest'),
        409: {
          description: 'Slug or email already taken',
          content: {
            'application/json': {
              schema: ref('Error'),
              examples: {
                slug: { value: errorExample('SLUG_TAKEN', 'This slug is already taken', { fields: { slug: 'This slug is already taken' } }) },
                email: {
                  value: errorExample('EMAIL_TAKEN', 'An account with this email already exists', {
                    fields: { email: 'An account with this email already exists' },
                  }),
                },
              },
            },
          },
        },
      },
    },
  },
  '/auth/slug-available': {
    get: {
      tags: ['Auth'],
      summary: 'Check whether a tenant slug is free (inline form validation)',
      operationId: 'slugAvailable',
      parameters: [{ name: 'slug', in: 'query', required: true, schema: { type: 'string', maxLength: 60 } }],
      responses: {
        200: ok('Availability', obj({ slug: { type: 'string' }, available: { type: 'boolean' } }), { slug: 'skyline', available: false }),
        400: resp('BadRequest'),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Log in with email + password',
      description:
        'Returns the access token in the body and sets the refresh token as an httpOnly cookie. Rate limited per IP + email in Redis (`rl:login:{ip}:{email}`): after 5 failures the pair is locked for 15 minutes and every attempt (even with the right password) gets 429 with `Retry-After`. Each failure reports `details.remainingAttempts`.',
      operationId: 'login',
      requestBody: body(ref('LoginRequest')),
      responses: {
        200: { description: 'Logged in', headers: setCookieHeader, content: json(ref('SessionResponse')) },
        400: resp('BadRequest'),
        401: {
          description: 'Wrong email or password',
          content: json(
            ref('Error'),
            errorExample('INVALID_CREDENTIALS', 'Email or password is incorrect', {
              remainingAttempts: 3,
              fields: { password: 'Email or password is incorrect (3 attempts left)' },
            }),
          ),
        },
        403: {
          description: 'Account or tenant deactivated',
          content: json(ref('Error'), errorExample('ACCOUNT_DISABLED', 'This account has been deactivated')),
        },
        429: resp('TooManyRequests'),
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Rotate the refresh token and get a new access token',
      description: [
        'Reads `pf_rt` from the cookie. The token is consumed atomically (Redis Lua script) and a new one in the **same family** is set.',
        '',
        '**Reuse detection:** presenting a token that was already used means it leaked. The whole family is deleted — including the newest, legitimate token — a CRITICAL `REFRESH_REUSE_DETECTED` security event is written, and 401 `REFRESH_REUSED` is returned.',
        '',
        'The web client serialises refreshes (one shared promise), so 5 parallel 401s cause exactly one call here. If the request carries an `Origin` header it must be the web origin (CSRF guard for the SameSite=None cookie).',
      ].join('\n'),
      operationId: 'refresh',
      security: [{ refreshCookie: [] }],
      responses: {
        200: { description: 'New access token; rotated cookie set', headers: setCookieHeader, content: json(ref('SessionResponse')) },
        401: {
          description: 'Missing, unknown, expired or reused refresh token (cookie is cleared)',
          content: {
            'application/json': {
              schema: ref('Error'),
              examples: {
                invalid: { value: errorExample('REFRESH_INVALID', 'Refresh token is invalid or expired') },
                reused: { value: errorExample('REFRESH_REUSED', 'Refresh token reuse detected. All sessions in this family were revoked.') },
              },
            },
          },
        },
        403: { description: 'Foreign Origin', content: json(ref('Error'), errorExample('FORBIDDEN_ORIGIN', 'Origin not allowed')) },
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: "Log out this device (revoke this session's family)",
      description: 'Idempotent. After this, a stolen refresh token from the same session is useless (401 on /auth/refresh). The cookie is cleared.',
      operationId: 'logout',
      security: [{ refreshCookie: [] }],
      responses: { 204: { description: 'Logged out' }, 403: { description: 'Foreign Origin', content: json(ref('Error')) } },
    },
  },
  '/auth/logout-all': {
    post: {
      tags: ['Auth'],
      summary: 'Log out every session of the current user',
      operationId: 'logoutAll',
      security: bearer,
      responses: { 200: ok('Sessions revoked', obj({ revokedSessions: { type: 'integer' } }), { revokedSessions: 3 }), 401: resp('Unauthorized') },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Current user profile',
      operationId: 'me',
      security: bearer,
      responses: { 200: ok('The user', obj({ user: ref('PublicUser') })), 401: resp('Unauthorized') },
    },
  },
  '/auth/invite': {
    post: {
      tags: ['Invites'],
      summary: 'Invite a user into the tenant (ADMIN)',
      description:
        'Creates a signed, single-use invite link valid for 24 h. No email is sent: the link is returned and logged. A newer invite for the same email revokes older pending ones. Alias of `POST /invites`.',
      operationId: 'createInvite',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('InviteRequest')),
      responses: {
        201: ok('Invite created', ref('InviteResponse')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        409: {
          description: 'A user with this email exists',
          content: json(
            ref('Error'),
            errorExample('EMAIL_TAKEN', 'A user with this email already exists', { fields: { email: 'A user with this email already exists' } }),
          ),
        },
      },
    },
  },
  '/auth/invite-info': {
    get: {
      tags: ['Invites'],
      summary: 'Inspect an invite link before accepting it',
      operationId: 'inviteInfo',
      parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
      responses: {
        200: ok('Invite details', ref('InviteInfo'), {
          email: 'rahul@skyline.dev',
          name: 'Rahul Verma',
          role: 'AGENT',
          tenant: { id: 1, name: 'Skyline Realty', slug: 'skyline' },
          expiresAt: '2026-10-02T04:31:10.000Z',
        }),
        422: {
          description: 'Invalid, expired, revoked or already used',
          content: json(ref('Error'), errorExample('INVITE_INVALID', 'Invite link has already been accepted')),
        },
      },
    },
  },
  '/auth/accept-invite': {
    post: {
      tags: ['Invites'],
      summary: 'Accept an invite: create the account and log in',
      description: 'Single use: the invite row is locked `FOR UPDATE` and `accepted_at` set in the same transaction that creates the user.',
      operationId: 'acceptInvite',
      requestBody: body(ref('AcceptInviteRequest')),
      responses: {
        201: { description: 'Account created, logged in', headers: setCookieHeader, content: json(ref('SessionResponse')) },
        400: resp('BadRequest'),
        409: { description: 'Email taken meanwhile', content: json(ref('Error')) },
        422: { description: 'Invalid / expired / used invite', content: json(ref('Error'), errorExample('INVITE_INVALID', 'Invite link has expired')) },
      },
    },
  },
  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List users of the tenant (ADMIN)',
      operationId: 'listUsers',
      security: bearer,
      'x-roles': ['ADMIN'],
      parameters: [
        { name: 'role', in: 'query', schema: ref('TenantRole') },
        { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Matches name or email' },
        { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: true } },
      ],
      responses: { 200: ok('Users', obj({ data: arr(ref('PublicUser')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
  },
  '/users/{id}': {
    parameters: [idPath('User id')],
    get: {
      tags: ['Users'],
      summary: 'Get one user of the tenant (ADMIN)',
      operationId: 'getUser',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: { 200: ok('User', ref('PublicUser')), 401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('NotFound') },
    },
    patch: {
      tags: ['Users'],
      summary: 'Change role, rename, deactivate / reactivate (ADMIN)',
      description:
        'The last active ADMIN of a tenant can be neither demoted nor deactivated (422 `LAST_ADMIN`; admin rows are locked FOR UPDATE so concurrent demotions cannot both pass). Deactivation or a role change revokes the user’s refresh tokens immediately.',
      operationId: 'updateUser',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('UpdateUserRequest')),
      responses: {
        200: ok('Updated user', ref('PublicUser')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: {
          description: 'Last admin guard',
          content: json(
            ref('Error'),
            errorExample('LAST_ADMIN', 'The last active admin cannot be demoted or deactivated', { fields: { role: 'At least one active admin is required' } }),
          ),
        },
      },
    },
  },
  '/invites': {
    get: {
      tags: ['Invites'],
      summary: 'List invites of the tenant, newest first (ADMIN)',
      operationId: 'listInvites',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: { 200: ok('Invites', obj({ data: arr(ref('Invite')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
    post: {
      tags: ['Invites'],
      summary: 'Create an invite (ADMIN) — same as POST /auth/invite',
      operationId: 'createInvite2',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('InviteRequest')),
      responses: {
        201: ok('Invite created', ref('InviteResponse')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        409: { description: 'Email taken', content: json(ref('Error')) },
      },
    },
  },
  '/invites/{id}/link': {
    parameters: [idPath('Invite id')],
    get: {
      tags: ['Invites'],
      summary: 'Re-issue the signed link of a pending invite ("Copy link")',
      operationId: 'inviteLink',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: {
        200: ok('Link', ref('InviteResponse')),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: { description: 'Invite not pending', content: json(ref('Error')) },
      },
    },
  },
  '/invites/{id}': {
    parameters: [idPath('Invite id')],
    delete: {
      tags: ['Invites'],
      summary: 'Revoke a pending invite (ADMIN)',
      operationId: 'revokeInvite',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: {
        200: ok('Revoked invite', ref('Invite')),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: resp('Unprocessable'),
      },
    },
  },
  '/platform/tenants': {
    get: {
      tags: ['Platform'],
      summary: 'Tenants console: every tenant with user counts (SUPER_ADMIN)',
      description:
        'Counts only. Property counts come from crm-api `GET /platform/tenant-stats`; the platform console never sees property details, owner phones or chats.',
      operationId: 'listTenants',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      responses: { 200: ok('Tenants', obj({ data: arr(ref('TenantSummary')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
    post: {
      tags: ['Platform'],
      summary: 'Create a tenant and invite its first ADMIN (SUPER_ADMIN)',
      description: 'One transaction: tenant row + ADMIN invite. Returns the invite link for the new admin.',
      operationId: 'createTenant',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      requestBody: body(ref('CreateTenantRequest')),
      responses: {
        201: ok('Tenant created', ref('CreateTenantResponse')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        409: {
          description: 'Slug or email taken (inline error on the drawer)',
          content: json(ref('Error'), errorExample('SLUG_TAKEN', 'This slug is already taken', { fields: { slug: 'This slug is already taken' } })),
        },
      },
    },
  },
  '/platform/tenants/{id}': {
    parameters: [idPath('Tenant id')],
    patch: {
      tags: ['Platform'],
      summary: 'Suspend / reactivate a tenant (SUPER_ADMIN)',
      description: 'Suspending revokes every refresh token of the tenant’s users; logins then fail with 403 ACCOUNT_DISABLED.',
      operationId: 'setTenantActive',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      requestBody: body(obj({ isActive: { type: 'boolean' } }, ['isActive']), { isActive: false }),
      responses: {
        200: ok('Tenant', obj({ id: { type: 'integer' }, name: { type: 'string' }, slug: { type: 'string' }, isActive: { type: 'boolean' } })),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
      },
    },
  },
  '/platform/security-events': {
    get: {
      tags: ['Platform'],
      summary: 'Security events feed (SUPER_ADMIN)',
      operationId: 'securityEvents',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string' }, example: 'REFRESH_REUSE_DETECTED' },
        { name: 'tenantId', in: 'query', schema: { type: 'integer' } },
        { name: 'beforeId', in: 'query', schema: { type: 'integer' }, description: 'Keyset pagination cursor' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
      ],
      responses: {
        200: ok('Events, newest first', obj({ data: arr(ref('SecurityEvent')), nextBeforeId: nullable({ type: 'integer' }) })),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
      },
    },
  },
  '/admin/keys': {
    get: {
      tags: ['Platform'],
      summary: 'Signing keys and their state (SUPER_ADMIN)',
      operationId: 'listKeys',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      responses: { 200: ok('Keys', obj({ data: arr(ref('SigningKeyInfo')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
  },
  '/admin/rotate-keys': {
    post: {
      tags: ['Platform'],
      summary: 'Rotate the signing key pair (SUPER_ADMIN)',
      description:
        'Generates a new RSA-2048 pair; new tokens are signed with it immediately. Previous keys are retired but stay in JWKS for `RETIRED_KEY_GRACE_SECONDS`, so access tokens (and invite links) they signed keep verifying — crm-api picks the new `kid` up on first sight without a restart. The new private key is stored AES-256-GCM encrypted with `KEY_ENCRYPTION_KEY` so all auth-server instances can sign with it.',
      operationId: 'rotateKeys',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      responses: {
        201: ok('Rotated', obj({ kid: { type: 'string' }, retired: arr({ type: 'string' }), keys: arr(ref('SigningKeyInfo')) })),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
      },
    },
  },
};

// ─────────────────────────────── crm-api ───────────────────────────────

const exProperty = {
  id: 1699,
  title: '2 BHK Apartment for sale in Powai',
  listingType: 'SALE',
  bhk: 2,
  furnishing: 'SEMI_FURNISHED',
  carpetAreaSqft: 720,
  priceInr: 18500000,
  pricePerSqft: 25694,
  listedPriceInr: 19500000,
  priceChangePct: -5.13,
  buildingName: 'Hiranandani Gardens A Wing',
  unitNo: '1203',
  floor: 12,
  totalFloors: 22,
  city: 'Mumbai',
  address: 'Hiranandani Gardens A Wing, Powai, Mumbai',
  ownerName: 'Rahul Shah',
  ownerPhone: '9830012321',
  ownerPhoneMasked: false,
  type: { id: 1, name: 'Apartment' },
  status: { id: 3, name: 'Site Visit', stage: 'OPEN', isTerminal: false, sortOrder: 30 },
  locality: { id: 3, name: 'Powai', city: 'Mumbai' },
  assignee: { id: 4, name: 'Riya Sharma' },
  isStale: false,
  lastActivityAt: '2026-09-28T09:12:00.000Z',
  closedAt: null,
  version: 4,
  createdAt: '2026-06-03T08:33:51.000Z',
  updatedAt: '2026-09-28T09:12:00.000Z',
  amenities: [
    { id: 1, name: 'Lift' },
    { id: 2, name: 'Parking' },
  ],
  amenityIds: [1, 2],
};
const { amenities: _a, amenityIds: _b, ...exListItem } = exProperty;

const propertyWrite = {
  title: { type: 'string', minLength: 3, maxLength: 200, 'x-section': 'Basics' },
  typeId: { type: 'integer', description: 'property_types.id (active)', 'x-section': 'Basics' },
  listingType: { type: 'string', enum: ['SALE', 'RENT'], 'x-section': 'Basics' },
  bhk: { type: 'integer', minimum: 0, maximum: 20, description: '0 for plots / commercial', 'x-section': 'Basics' },
  furnishing: { type: 'string', enum: ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'], default: 'UNFURNISHED', 'x-section': 'Basics' },
  statusId: { type: 'integer', description: 'Defaults to the first open status (Draft)', 'x-section': 'Basics' },
  buildingName: { type: 'string', minLength: 1, maxLength: 150, 'x-section': 'Location' },
  unitNo: { type: 'string', minLength: 1, maxLength: 40, description: 'Unique per (tenant, building) among live listings', 'x-section': 'Location' },
  floor: nullable({ type: 'integer', minimum: -5, maximum: 200, 'x-section': 'Location' }),
  totalFloors: nullable({ type: 'integer', minimum: 0, maximum: 200, 'x-section': 'Location' }),
  localityId: { type: 'integer', 'x-section': 'Location' },
  city: { type: 'string', minLength: 2, maxLength: 80, 'x-section': 'Location' },
  address: nullable({ type: 'string', maxLength: 500, 'x-section': 'Location' }),
  priceInr: {
    type: 'integer',
    minimum: 1,
    maximum: 10000000000,
    description: 'Whole rupees. Sale price, or monthly rent for RENT',
    'x-section': 'Pricing & size',
  },
  carpetAreaSqft: { type: 'integer', minimum: 1, maximum: 1000000, 'x-section': 'Pricing & size' },
  ownerName: { type: 'string', minLength: 2, maxLength: 120, 'x-section': 'Owner' },
  ownerPhone: {
    type: 'string',
    description: 'Indian mobile; `+91`/`0` prefix, spaces and dashes accepted; stored as 10 digits',
    pattern: '^(?:\\+91|91|0)?[6-9]\\d{9}$',
    example: '+91 98300 12321',
    'x-section': 'Owner',
  },
  amenityIds: arr({ type: 'integer' }, { maxItems: 50, default: [], 'x-section': 'Amenities' }),
  assigneeId: nullable({
    type: 'integer',
    description: 'ADMIN/MANAGER only. An AGENT’s listings are always assigned to themselves (a different value → 403).',
  }),
};

const listFilterParams = [
  {
    name: 'status',
    in: 'query',
    description: 'Status ids — repeat (`status=2&status=3`) or comma-separate (`status=2,3`)',
    schema: arr({ type: 'integer' }),
    style: 'form',
    explode: false,
  },
  { name: 'type', in: 'query', description: 'Property type ids', schema: arr({ type: 'integer' }), style: 'form', explode: false },
  { name: 'listingType', in: 'query', schema: { type: 'string', enum: ['SALE', 'RENT'] } },
  { name: 'bhk', in: 'query', schema: arr({ type: 'integer', minimum: 0, maximum: 20 }), style: 'form', explode: false },
  { name: 'locality', in: 'query', description: 'Locality ids', schema: arr({ type: 'integer' }), style: 'form', explode: false },
  {
    name: 'assignee',
    in: 'query',
    description: 'Agent (user) ids. ADMIN/MANAGER only — an AGENT sending it gets 403.',
    schema: arr({ type: 'integer' }),
    style: 'form',
    explode: false,
  },
  { name: 'amenity', in: 'query', description: 'Amenity ids — listing must have ALL of them', schema: arr({ type: 'integer' }), style: 'form', explode: false },
  { name: 'priceMin', in: 'query', schema: { type: 'integer', minimum: 0 }, example: 5000000 },
  { name: 'priceMax', in: 'query', schema: { type: 'integer', minimum: 0 }, example: 20000000 },
  { name: 'areaMin', in: 'query', schema: { type: 'integer', minimum: 0 } },
  { name: 'areaMax', in: 'query', schema: { type: 'integer', minimum: 0 } },
  { name: 'createdFrom', in: 'query', schema: { type: 'string', format: 'date-time' }, example: '2026-01-01T00:00:00+05:30' },
  { name: 'createdTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
  { name: 'stale', in: 'query', schema: { type: 'boolean' }, description: 'Only (non-)stale listings' },
  {
    name: 'q',
    in: 'query',
    schema: { type: 'string', maxLength: 100 },
    description: 'Free text over title, building, unit, locality name, owner name and owner phone digits',
  },
];

const sortFields = [
  'id',
  'title',
  'listingType',
  'bhk',
  'furnishing',
  'carpetAreaSqft',
  'priceInr',
  'pricePerSqft',
  'buildingName',
  'unitNo',
  'city',
  'ownerName',
  'status',
  'type',
  'locality',
  'assignee',
  'createdAt',
  'updatedAt',
  'lastActivityAt',
];

const masterItem = (extra = {}, example) =>
  obj(
    { id: { type: 'integer' }, name: { type: 'string' }, sortOrder: { type: 'integer' }, isActive: { type: 'boolean' }, ...extra },
    ['id', 'name', 'sortOrder', 'isActive'],
    example ? { example } : {},
  );

const crmSchemas = {
  ...sharedSchemas,
  Ref: obj({ id: { type: 'integer' }, name: nullable({ type: 'string' }) }, ['id', 'name']),
  StatusRef: obj(
    {
      id: { type: 'integer' },
      name: nullable({ type: 'string' }),
      stage: { type: 'string', enum: ['OPEN', 'WON', 'LOST'] },
      isTerminal: { type: 'boolean' },
      sortOrder: { type: 'integer' },
    },
    ['id', 'name'],
  ),
  LocalityRef: obj({ id: { type: 'integer' }, name: nullable({ type: 'string' }), city: { type: 'string' } }, ['id', 'name']),
  PropertyListItem: obj(
    {
      id: { type: 'integer' },
      title: { type: 'string' },
      listingType: { type: 'string', enum: ['SALE', 'RENT'] },
      bhk: { type: 'integer' },
      furnishing: { type: 'string', enum: ['UNFURNISHED', 'SEMI_FURNISHED', 'FULLY_FURNISHED'] },
      carpetAreaSqft: { type: 'integer' },
      priceInr: { type: 'integer' },
      pricePerSqft: nullable({ type: 'integer', description: 'Computed: round(priceInr / carpetAreaSqft)' }),
      listedPriceInr: { type: 'integer', description: 'Price when first listed' },
      priceChangePct: { type: 'number', description: 'Change since listing, in %' },
      buildingName: { type: 'string' },
      unitNo: { type: 'string' },
      floor: nullable({ type: 'integer' }),
      totalFloors: nullable({ type: 'integer' }),
      city: { type: 'string' },
      address: nullable({ type: 'string' }),
      ownerName: { type: 'string' },
      ownerPhone: { type: 'string', description: 'Full number for ADMIN/MANAGER and the assignee; otherwise masked in the serializer as `98300 •••21`' },
      ownerPhoneMasked: { type: 'boolean' },
      type: ref('Ref'),
      status: ref('StatusRef'),
      locality: ref('LocalityRef'),
      assignee: nullable(ref('Ref')),
      isStale: { type: 'boolean', description: 'Set by the nightly job after 30 days without activity' },
      lastActivityAt: { type: 'string', format: 'date-time' },
      closedAt: nullable({ type: 'string', format: 'date-time' }),
      version: { type: 'integer', description: 'Optimistic-locking version; send it back on PATCH' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    ['id', 'title', 'listingType', 'priceInr', 'status', 'version'],
    { example: exListItem },
  ),
  Property: {
    allOf: [ref('PropertyListItem'), obj({ amenities: arr(ref('Ref')), amenityIds: arr({ type: 'integer' }) })],
    example: exProperty,
  },
  PropertyCreate: obj(
    propertyWrite,
    ['title', 'typeId', 'listingType', 'bhk', 'buildingName', 'unitNo', 'localityId', 'city', 'priceInr', 'carpetAreaSqft', 'ownerName', 'ownerPhone'],
    {
      description: 'Shared Zod schema `propertyCreateSchema` (packages/shared). Sections mirror the 5-section form. `floor` must be ≤ `totalFloors`.',
      example: {
        title: '2 BHK Apartment for sale in Powai',
        typeId: 1,
        listingType: 'SALE',
        bhk: 2,
        furnishing: 'SEMI_FURNISHED',
        buildingName: 'Hiranandani Gardens A Wing',
        unitNo: '1203',
        floor: 12,
        totalFloors: 22,
        localityId: 3,
        city: 'Mumbai',
        address: 'Hiranandani Gardens, Powai',
        priceInr: 18500000,
        carpetAreaSqft: 720,
        ownerName: 'Rahul Shah',
        ownerPhone: '+91 98300 12321',
        amenityIds: [1, 2],
      },
    },
  ),
  PropertyUpdate: obj(
    { ...propertyWrite, version: { type: 'integer', minimum: 1, description: 'The version you loaded. Stale → 409 VERSION_CONFLICT.' } },
    ['version'],
    {
      description: 'Partial update. Every changed field is written to property_activity as a JSON diff (incl. price history).',
      example: { version: 4, priceInr: 17900000, statusId: 4 },
    },
  ),
  PropertyPage: obj(
    {
      data: arr(ref('PropertyListItem')),
      page: { type: 'integer' },
      pageSize: { type: 'integer', maximum: 100 },
      total: { type: 'integer', description: 'All rows matching the filters' },
      totalPages: { type: 'integer' },
      sortBy: { type: 'string', enum: sortFields },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
    },
    ['data', 'page', 'pageSize', 'total', 'totalPages'],
    { example: { data: [exListItem], page: 1, pageSize: 25, total: 10482, totalPages: 420, sortBy: 'createdAt', sortOrder: 'desc' } },
  ),
  VersionConflict: {
    allOf: [ref('Error')],
    example: errorExample('VERSION_CONFLICT', 'This listing was changed by someone else since you opened it', {
      yourVersion: 3,
      currentVersion: 4,
      current: exProperty,
    }),
    description: '`details.current` is the full server copy, used by the conflict dialog (Theirs vs Yours per field).',
  },
  BulkAction: {
    description: 'Up to 500 ids, one transaction, all-or-nothing. Ids outside your tenant count as missing → 422 and nothing changes.',
    oneOf: [
      obj({ action: { type: 'string', enum: ['reassign'] }, ids: arr({ type: 'integer' }, { minItems: 1, maxItems: 500 }), assigneeId: { type: 'integer' } }, [
        'action',
        'ids',
        'assigneeId',
      ]),
      obj(
        { action: { type: 'string', enum: ['changeStatus'] }, ids: arr({ type: 'integer' }, { minItems: 1, maxItems: 500 }), statusId: { type: 'integer' } },
        ['action', 'ids', 'statusId'],
      ),
      obj({ action: { type: 'string', enum: ['addAmenity'] }, ids: arr({ type: 'integer' }, { minItems: 1, maxItems: 500 }), amenityId: { type: 'integer' } }, [
        'action',
        'ids',
        'amenityId',
      ]),
    ],
    discriminator: { propertyName: 'action' },
  },
  BulkResult: obj({ action: { type: 'string' }, affected: { type: 'integer' }, ids: arr({ type: 'integer' }) }, ['action', 'affected', 'ids'], {
    example: { action: 'reassign', affected: 50, ids: [101, 102] },
  }),
  DuplicateCheck: obj({ duplicate: { type: 'boolean' }, existingId: { type: 'integer', description: 'Only when you may see that listing' } }, ['duplicate'], {
    example: { duplicate: true, existingId: 1699 },
  }),
  Activity: obj(
    {
      id: { type: 'integer' },
      action: { type: 'string', enum: ['CREATED', 'UPDATED', 'DELETED', 'BULK_REASSIGN', 'BULK_STATUS', 'BULK_AMENITY', 'MARKED_STALE'] },
      summary: nullable({ type: 'string' }),
      diff: nullable({
        type: 'object',
        additionalProperties: obj({ from: {}, to: {}, fromLabel: nullable({ type: 'string' }), toLabel: nullable({ type: 'string' }) }),
      }),
      actor: nullable(ref('Ref')),
      createdAt: { type: 'string', format: 'date-time' },
    },
    [],
    {
      example: {
        id: 991,
        action: 'UPDATED',
        summary: 'Status: Listed → Site Visit; Price: ₹1.95 Cr → ₹1.85 Cr',
        diff: {
          statusId: { from: 2, to: 3, fromLabel: 'Listed', toLabel: 'Site Visit' },
          priceInr: { from: 19500000, to: 18500000, fromLabel: '₹1.95 Cr', toLabel: '₹1.85 Cr' },
        },
        actor: { id: 4, name: 'Riya Sharma' },
        createdAt: '2026-09-28T09:12:00.000Z',
      },
    },
  ),
  Note: obj({
    id: { type: 'integer' },
    propertyId: { type: 'integer' },
    body: { type: 'string' },
    author: ref('Ref'),
    createdAt: { type: 'string', format: 'date-time' },
  }),
  NoteCreate: obj({ body: { type: 'string', minLength: 1, maxLength: 5000 } }, ['body'], {
    example: { body: 'Owner open to negotiation; prefers closure before Diwali.' },
  }),
  ChatMessage: obj(
    {
      id: { type: 'integer' },
      propertyId: { type: 'integer' },
      clientMsgId: { type: 'string' },
      body: { type: 'string' },
      sender: ref('Ref'),
      createdAt: { type: 'string', format: 'date-time' },
    },
    [],
    {
      example: {
        id: 5521,
        propertyId: 1699,
        clientMsgId: 'c-01J9Z3K4',
        body: 'Owner confirmed Saturday 11 AM',
        sender: { id: 4, name: 'Riya Sharma' },
        createdAt: '2026-10-01T05:20:11.000Z',
      },
    },
  ),
  ChatSendRest: obj(
    {
      clientMsgId: {
        type: 'string',
        minLength: 8,
        maxLength: 64,
        pattern: '^[A-Za-z0-9_-]+$',
        description: 'Client-generated; unique per property; reuse it on retry',
      },
      body: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    ['clientMsgId', 'body'],
    { example: { clientMsgId: 'c-01J9Z3K4', body: 'Owner confirmed Saturday 11 AM' } },
  ),
  ChatSendResult: obj({
    message: ref('ChatMessage'),
    duplicate: { type: 'boolean', description: 'true when this client_msg_id was already stored (nothing new written or broadcast)' },
  }),
  ChatHistory: obj({ data: arr(ref('ChatMessage')), nextBeforeId: nullable({ type: 'integer' }) }),
  SiteVisit: obj(
    {
      id: { type: 'integer' },
      propertyId: { type: 'integer' },
      agent: ref('Ref'),
      visitAt: { type: 'string', format: 'date-time', description: 'UTC (Z). Render in the user’s zone.' },
      endAt: { type: 'string', format: 'date-time' },
      durationMinutes: { type: 'integer' },
      visitorName: nullable({ type: 'string' }),
      visitorPhone: nullable({ type: 'string' }),
      notes: nullable({ type: 'string' }),
      outcome: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'INTERESTED', 'NOT_INTERESTED'] },
      isOverdue: { type: 'boolean', description: 'SCHEDULED and in the past (drawn red)' },
      remindedAt: nullable({ type: 'string', format: 'date-time' }),
      property: nullable(
        obj({
          id: { type: 'integer' },
          title: { type: 'string' },
          buildingName: { type: 'string' },
          unitNo: { type: 'string' },
          ownerName: { type: 'string' },
          ownerPhone: { type: 'string', description: 'Masked when the viewer is an agent who is not the listing’s assignee' },
          ownerPhoneMasked: { type: 'boolean' },
          assigneeId: nullable({ type: 'integer' }),
        }),
      ),
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    [],
    {
      example: {
        id: 77,
        propertyId: 1699,
        agent: { id: 4, name: 'Riya Sharma' },
        visitAt: '2026-10-01T04:30:00.000Z',
        endAt: '2026-10-01T05:30:00.000Z',
        durationMinutes: 60,
        visitorName: 'Amit Joshi',
        visitorPhone: null,
        notes: null,
        outcome: 'SCHEDULED',
        isOverdue: false,
        remindedAt: null,
        property: {
          id: 1699,
          title: '2 BHK Apartment for sale in Powai',
          buildingName: 'Hiranandani Gardens A Wing',
          unitNo: '1203',
          ownerName: 'Rahul Shah',
          ownerPhone: '9830012321',
          ownerPhoneMasked: false,
          assigneeId: 4,
        },
        createdAt: '2026-09-29T10:00:00.000Z',
        updatedAt: '2026-09-29T10:00:00.000Z',
      },
    },
  ),
  SiteVisitCreate: obj(
    {
      propertyId: { type: 'integer' },
      visitAt: {
        type: 'string',
        format: 'date-time',
        description: 'ISO-8601 with offset; stored as UTC. `2026-10-01T10:00:00+05:30` → `2026-10-01T04:30:00Z`',
      },
      durationMinutes: { type: 'integer', minimum: 15, maximum: 480, default: 60 },
      visitorName: { type: 'string', maxLength: 120 },
      visitorPhone: { type: 'string', maxLength: 20 },
      notes: { type: 'string', maxLength: 2000 },
      agentId: { type: 'integer', description: 'ADMIN/MANAGER may schedule for another agent (defaults to the listing’s assignee). AGENT: self only.' },
    },
    ['propertyId', 'visitAt'],
    { example: { propertyId: 1699, visitAt: '2026-10-01T10:00:00+05:30', durationMinutes: 60, visitorName: 'Amit Joshi' } },
  ),
  SiteVisitUpdate: obj(
    {
      visitAt: { type: 'string', format: 'date-time', description: 'Drag-and-drop reschedule. Changing it re-arms the 15-minute reminder.' },
      durationMinutes: { type: 'integer', minimum: 15, maximum: 480 },
      outcome: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'INTERESTED', 'NOT_INTERESTED'] },
      notes: nullable({ type: 'string', maxLength: 2000 }),
      agentId: { type: 'integer', description: 'ADMIN/MANAGER only' },
    },
    [],
    { minProperties: 1, example: { visitAt: '2026-10-02T06:00:00Z' } },
  ),
  Dashboard: obj(
    {
      range: obj({ from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, tz: { type: 'string' } }),
      kpis: obj({
        newListings: { type: 'integer' },
        activeListings: { type: 'integer' },
        closedDeals: { type: 'integer' },
        closedValue: { type: 'integer', description: '₹' },
        avgPricePerSqft: nullable({ type: 'integer' }),
      }),
      listingsOverTime: arr(
        obj({ date: { type: 'string', format: 'date' }, total: { type: 'integer' }, sale: { type: 'integer' }, rent: { type: 'integer' } }),
        { description: 'One entry per day (zero-filled), bucketed in `tz`' },
      ),
      funnel: arr(
        obj({
          statusId: { type: 'integer' },
          name: { type: 'string' },
          stage: { type: 'string' },
          count: { type: 'integer', description: 'Currently at this stage' },
          reached: { type: 'integer', description: 'At or beyond this stage' },
        }),
      ),
      lost: arr(obj({ statusId: { type: 'integer' }, name: { type: 'string' }, count: { type: 'integer' } })),
      typeSplit: arr(obj({ typeId: { type: 'integer' }, name: nullable({ type: 'string' }), count: { type: 'integer' }, value: { type: 'integer' } })),
      topAgents: arr(
        obj({ agentId: { type: 'integer' }, name: nullable({ type: 'string' }), closedCount: { type: 'integer' }, closedValue: { type: 'integer' } }),
        { maxItems: 5 },
      ),
      isEmpty: { type: 'boolean', description: 'Drives the empty state' },
      generatedAt: { type: 'string', format: 'date-time' },
      cached: { type: 'boolean' },
    },
    [],
    {
      example: {
        range: { from: '2026-09-01', to: '2026-09-30', tz: 'Asia/Kolkata' },
        kpis: { newListings: 842, activeListings: 7498, closedDeals: 141, closedValue: 2310450000, avgPricePerSqft: 19191 },
        listingsOverTime: [{ date: '2026-09-01', total: 31, sale: 22, rent: 9 }],
        funnel: [
          { statusId: 1, name: 'Draft', stage: 'OPEN', count: 51, reached: 842 },
          { statusId: 5, name: 'Closed', stage: 'WON', count: 141, reached: 141 },
        ],
        lost: [{ statusId: 6, name: 'Withdrawn', count: 62 }],
        typeSplit: [{ typeId: 1, name: 'Apartment', count: 590, value: 9800000000 }],
        topAgents: [{ agentId: 5, name: 'Kabir Singh', closedCount: 73, closedValue: 1204000000 }],
        isEmpty: false,
        generatedAt: '2026-10-01T05:00:00.000Z',
        cached: false,
      },
    },
  ),
  StatusItem: masterItem(
    {
      stage: { type: 'string', enum: ['OPEN', 'WON', 'LOST'] },
      isTerminal: { type: 'boolean' },
      key: nullable({ type: 'string', description: 'Stable key of seeded statuses (draft, listed, site_visit, negotiation, closed, withdrawn)' }),
    },
    { id: 5, name: 'Closed', sortOrder: 50, isActive: true, stage: 'WON', isTerminal: true, key: 'closed' },
  ),
  LocalityItem: masterItem({ city: { type: 'string' } }, { id: 3, name: 'Powai', sortOrder: 30, isActive: true, city: 'Mumbai' }),
  MasterItem: masterItem({}, { id: 1, name: 'Apartment', sortOrder: 10, isActive: true }),
  MasterItemAny: { oneOf: [ref('StatusItem'), ref('LocalityItem'), ref('MasterItem')] },
  MasterItemWrite: obj(
    {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      sortOrder: { type: 'integer', minimum: 0 },
      isActive: { type: 'boolean' },
      stage: { type: 'string', enum: ['OPEN', 'WON', 'LOST'], description: '`statuses` only (default OPEN). WON/LOST are terminal.' },
      city: { type: 'string', description: '`localities` only (required on create)' },
    },
    [],
    { example: { name: 'Hiranandani Estate', city: 'Thane' } },
  ),
  MasterDataAll: obj({
    statuses: arr(ref('StatusItem')),
    types: arr(ref('MasterItem')),
    localities: arr(ref('LocalityItem')),
    amenities: arr(ref('MasterItem')),
  }),
  TeamMember: obj({ id: { type: 'integer' }, name: { type: 'string' }, role: ref('TenantRole') }),
  TenantStats: obj(
    { tenantId: { type: 'integer' }, properties: { type: 'integer' }, activeProperties: { type: 'integer' }, closedProperties: { type: 'integer' } },
    [],
    { example: { tenantId: 1, properties: 10000, activeProperties: 7498, closedProperties: 1702 } },
  ),
  CrmHealth: obj({
    status: { type: 'string', enum: ['ok', 'degraded'] },
    service: { type: 'string', example: 'crm-api' },
    instance: { type: 'string', description: 'Which crm-api instance answered (useful behind nginx with scale=2)' },
    version: { type: 'string' },
    uptimeSeconds: { type: 'integer' },
    checks: obj({
      mysql: ref('HealthCheck'),
      redis: ref('HealthCheck'),
      jwks: obj({
        status: { type: 'string', enum: ['up', 'down'] },
        kids: arr({ type: 'string' }),
        cacheAgeSeconds: nullable({ type: 'integer' }),
        lastFetchedAt: nullable({ type: 'string', format: 'date-time' }),
        lastError: nullable({ type: 'string' }),
      }),
    }),
  }),
  // Auth-server shapes re-used by the /users and /invites pass-through.
  PublicUser: authSchemas.PublicUser,
  Invite: authSchemas.Invite,
  InviteRequest: authSchemas.InviteRequest,
  InviteResponse: authSchemas.InviteResponse,
  UpdateUserRequest: authSchemas.UpdateUserRequest,
};

const { TooManyRequests: _tmr, ...crmResponses } = sharedResponses;

const kindParam = { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['statuses', 'types', 'localities', 'amenities'] } };
const proxied =
  'Forwarded to auth-server with the caller’s bearer token (identity lives in auth_db; the two services never share a database). auth-server re-checks role and tenant.';
const scopedNote =
  'Scoped: tenant from the token; AGENT only sees listings assigned to them. Anything outside the scope is **404** (never 403 — that would leak existence).';

const crmPaths = {
  '/health': {
    get: {
      tags: ['System'],
      summary: 'MySQL, Redis and JWKS status',
      operationId: 'crmHealth',
      responses: {
        200: ok('Healthy', ref('CrmHealth'), {
          status: 'ok',
          service: 'crm-api',
          instance: 'crm-api-1',
          version: '1.0.0',
          uptimeSeconds: 812,
          checks: {
            mysql: { status: 'up', latencyMs: 2 },
            redis: { status: 'up', latencyMs: 1 },
            jwks: { status: 'up', kids: ['DA0pWsLS3YIsoxQKTRDiGOMJCKT6LJq-'], cacheAgeSeconds: 41, lastFetchedAt: '2026-10-01T05:00:00.000Z', lastError: null },
          },
        }),
        503: ok('Degraded', ref('CrmHealth')),
      },
    },
  },
  '/properties': {
    get: {
      tags: ['Properties'],
      summary: 'List properties — server-side pagination, sort and filters',
      description: `${scopedNote}\n\nMax pageSize 100. Returns \`total\` for the grid. p95 < 300 ms on 10k rows (see DECISIONS.md §3 for indexes and EXPLAIN).`,
      operationId: 'listProperties',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
        {
          name: 'sortBy',
          in: 'query',
          schema: { type: 'string', enum: sortFields, default: 'createdAt' },
          description: '`status` sorts by pipeline order; `type`/`locality`/`assignee` by name',
        },
        { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        ...listFilterParams,
      ],
      responses: { 200: ok('One page', ref('PropertyPage')), 400: resp('BadRequest'), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
    post: {
      tags: ['Properties'],
      summary: 'Create a property',
      description:
        'Validated with the shared `propertyCreateSchema`. Uniqueness of (tenant, building, unit) is enforced by a DB unique index, so two parallel identical POSTs give exactly one 201 and one 409. Writes a CREATED activity row and emits `property:updated`.',
      operationId: 'createProperty',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('PropertyCreate')),
      responses: {
        201: ok('Created', ref('Property')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: {
          description: 'AGENT tried to assign to someone else',
          content: json(ref('Error'), errorExample('FORBIDDEN_ROLE', 'Agents cannot assign listings to others')),
        },
        409: {
          description: 'Duplicate building + unit',
          content: json(
            ref('Error'),
            errorExample('DUPLICATE_LISTING', 'A listing with this building and unit already exists', {
              fields: { unitNo: 'This unit is already listed in this building' },
              existingId: 1699,
            }),
          ),
        },
        422: resp('Unprocessable'),
      },
    },
  },
  '/properties/export': {
    get: {
      tags: ['Properties'],
      summary: 'Export the filtered view to .xlsx (ALL matching rows)',
      description:
        'Same filters as the list (pagination ignored). Streamed with ExcelJS `WorkbookWriter` straight into the response; rows are read in keyset batches (`id > lastId LIMIT 1000`) and committed one at a time, waiting for `drain` under back-pressure, so memory stays flat for 10k+ rows. `X-Total-Count` is set before the body. An AGENT gets 403 and the button is not rendered.',
      operationId: 'exportProperties',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER'],
      parameters: listFilterParams,
      responses: {
        200: {
          description: 'Excel workbook',
          headers: {
            'Content-Disposition': { schema: { type: 'string', example: 'attachment; filename="propflow-properties-202610010930.xlsx"' } },
            'X-Total-Count': { schema: { type: 'integer', example: 10000 } },
          },
          content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } },
        },
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
      },
    },
  },
  '/properties/check-duplicate': {
    get: {
      tags: ['Properties'],
      summary: 'Inline duplicate check for building + unit',
      operationId: 'checkDuplicate',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [
        { name: 'buildingName', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'unitNo', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'excludeId', in: 'query', schema: { type: 'integer' }, description: 'The listing being edited' },
      ],
      responses: { 200: ok('Result', ref('DuplicateCheck')), 400: resp('BadRequest'), 401: resp('Unauthorized') },
    },
  },
  '/properties/bulk': {
    post: {
      tags: ['Properties'],
      summary: 'Bulk reassign / change status / add amenity (≤ 500 ids, all-or-nothing)',
      description:
        'Rows are locked FOR UPDATE inside one transaction. Any unknown/foreign id, or a Closed/Withdrawn listing on changeStatus, rolls the whole request back. One activity row per listing.',
      operationId: 'bulkProperties',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: ref('BulkAction'),
            examples: {
              reassign: { value: { action: 'reassign', ids: [101, 102, 103], assigneeId: 5 } },
              changeStatus: { value: { action: 'changeStatus', ids: [101, 102], statusId: 3 } },
              addAmenity: { value: { action: 'addAmenity', ids: [101], amenityId: 4 } },
            },
          },
        },
      },
      responses: {
        200: ok('Applied', ref('BulkResult')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        422: {
          description: 'Nothing changed',
          content: {
            'application/json': {
              schema: ref('Error'),
              examples: {
                missing: { value: errorExample('BUSINESS_RULE', 'Some listings were not found; nothing was changed', { missingIds: [999999] }) },
                terminal: {
                  value: errorExample('TERMINAL_STATUS', 'Some listings are Closed/Withdrawn and cannot change status; nothing was changed', { ids: [102] }),
                },
              },
            },
          },
        },
      },
    },
  },
  '/properties/{id}': {
    parameters: [idPath('Property id')],
    get: {
      tags: ['Properties'],
      summary: 'Property detail',
      description: `${scopedNote} Owner phone is masked unless you are the assignee, a MANAGER or an ADMIN.`,
      operationId: 'getProperty',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      responses: { 200: ok('Property', ref('Property')), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
    patch: {
      tags: ['Properties'],
      summary: 'Update with optimistic locking',
      description:
        'Body must include the `version` you loaded. The row is locked FOR UPDATE; if the version is stale → 409 with the full current copy in `details.current` (drives the conflict dialog: "Save merged" re-sends with the latest version). Every changed field goes into property_activity as a diff. Closed/Withdrawn are terminal (422). AGENTs cannot reassign.',
      operationId: 'updateProperty',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('PropertyUpdate')),
      responses: {
        200: ok('Updated (version incremented)', ref('Property')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        409: {
          description: 'Stale version or duplicate building + unit',
          content: {
            'application/json': {
              schema: ref('Error'),
              examples: {
                versionConflict: {
                  value: errorExample('VERSION_CONFLICT', 'This listing was changed by someone else since you opened it', {
                    yourVersion: 3,
                    currentVersion: 4,
                    current: exProperty,
                  }),
                },
                duplicate: {
                  value: errorExample('DUPLICATE_LISTING', 'A listing with this building and unit already exists', {
                    fields: { unitNo: 'This unit is already listed in this building' },
                  }),
                },
              },
            },
          },
        },
        422: {
          description: 'Terminal status',
          content: json(
            ref('Error'),
            errorExample('TERMINAL_STATUS', '"Closed" is a terminal status; the listing can no longer change stage', {
              fields: { statusId: 'Closed and Withdrawn listings cannot move' },
            }),
          ),
        },
      },
    },
    delete: {
      tags: ['Properties'],
      summary: 'Soft delete',
      description: 'Sets deleted_at (paranoid). The unit becomes free for a new listing (the unique index only covers live rows).',
      operationId: 'deleteProperty',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER'],
      responses: { 204: { description: 'Deleted' }, 401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('NotFound') },
    },
  },
  '/properties/{id}/activity': {
    parameters: [idPath('Property id')],
    get: {
      tags: ['Properties'],
      summary: 'Activity timeline (status, price, assignment changes…), newest first',
      operationId: 'propertyActivity',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      responses: { 200: ok('Timeline', obj({ data: arr(ref('Activity')) })), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
  },
  '/properties/{id}/notes': {
    parameters: [idPath('Property id')],
    get: {
      tags: ['Notes & chat'],
      summary: 'Notes on a property, newest first',
      operationId: 'listNotes',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      responses: { 200: ok('Notes', obj({ data: arr(ref('Note')) })), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
    post: {
      tags: ['Notes & chat'],
      summary: 'Add a note (broadcast as `note:new` to the property room)',
      operationId: 'addNote',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('NoteCreate')),
      responses: { 201: ok('Created', ref('Note')), 400: resp('BadRequest'), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
  },
  '/properties/{id}/messages': {
    parameters: [idPath('Property id')],
    get: {
      tags: ['Notes & chat'],
      summary: 'Chat history (oldest → newest within the page)',
      operationId: 'listMessages',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [
        { name: 'beforeId', in: 'query', schema: { type: 'integer' }, description: 'Load older messages' },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      ],
      responses: { 200: ok('Messages', ref('ChatHistory')), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
    post: {
      tags: ['Notes & chat'],
      summary: 'Send a chat message over REST (fallback for `chat:send`)',
      description:
        'Idempotent on (property_id, client_msg_id): the first call returns 201 and broadcasts `chat:new`; a retry with the same clientMsgId returns 200 with the original message and `duplicate: true`.',
      operationId: 'sendMessage',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('ChatSendRest')),
      responses: {
        201: ok('Stored and broadcast', ref('ChatSendResult')),
        200: ok('Retry of an already stored message', ref('ChatSendResult')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        404: resp('NotFound'),
      },
    },
  },
  '/site-visits': {
    get: {
      tags: ['Site visits'],
      summary: 'Calendar feed (AGENT: own visits; ADMIN/MANAGER: whole team)',
      operationId: 'listVisits',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [
        { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' }, example: '2026-09-28T18:30:00Z' },
        { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' }, example: '2026-11-08T18:30:00Z' },
        { name: 'agentId', in: 'query', schema: { type: 'integer' }, description: 'ADMIN/MANAGER only' },
        { name: 'propertyId', in: 'query', schema: { type: 'integer' }, description: '404 if the property is not visible to you' },
      ],
      responses: {
        200: ok('Visits ordered by time', obj({ data: arr(ref('SiteVisit')) })),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        404: resp('NotFound'),
      },
    },
    post: {
      tags: ['Site visits'],
      summary: 'Schedule a site visit (stored in UTC)',
      operationId: 'createVisit',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('SiteVisitCreate')),
      responses: {
        201: ok('Scheduled', ref('SiteVisit')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: resp('Unprocessable'),
      },
    },
  },
  '/site-visits/{id}': {
    parameters: [idPath('Site visit id')],
    get: {
      tags: ['Site visits'],
      summary: 'One visit',
      operationId: 'getVisit',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      responses: { 200: ok('Visit', ref('SiteVisit')), 401: resp('Unauthorized'), 404: resp('NotFound') },
    },
    patch: {
      tags: ['Site visits'],
      summary: 'Reschedule (drag-and-drop) / record outcome',
      operationId: 'updateVisit',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      requestBody: body(ref('SiteVisitUpdate')),
      responses: { 200: ok('Updated', ref('SiteVisit')), 400: resp('BadRequest'), 401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('NotFound') },
    },
  },
  '/dashboard': {
    get: {
      tags: ['Dashboard'],
      summary: 'KPIs + funnel, listings per day, type split, top 5 agents',
      description:
        'One call per date range. Cached 60 s per tenant + range in Redis (`dash:{tenantId}:{from}:{to}`); any property write clears the tenant’s dashboard keys.',
      operationId: 'dashboard',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER'],
      parameters: [
        { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' }, example: '2026-09-01' },
        { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' }, example: '2026-09-30' },
        { name: 'tz', in: 'query', schema: { type: 'string', default: 'Asia/Kolkata' }, description: 'IANA zone used for day buckets' },
      ],
      responses: { 200: ok('Dashboard', ref('Dashboard')), 400: resp('BadRequest'), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
  },
  '/master-data': {
    get: {
      tags: ['Master data'],
      summary: 'All four lists in one call (forms and filters)',
      operationId: 'masterDataAll',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false } }],
      responses: { 200: ok('Master data', ref('MasterDataAll')), 401: resp('Unauthorized') },
    },
  },
  '/master-data/{kind}': {
    parameters: [kindParam],
    get: {
      tags: ['Master data'],
      summary: 'List one kind, in sort order (Redis read-through `md:{tenantId}:{kind}`)',
      operationId: 'masterDataList',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER', 'AGENT'],
      parameters: [{ name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false } }],
      responses: { 200: ok('Items', obj({ data: arr(ref('MasterItemAny')) })), 400: resp('BadRequest'), 401: resp('Unauthorized') },
    },
    post: {
      tags: ['Master data'],
      summary: 'Create an item (ADMIN)',
      description: 'Clears `md:{tenant}:*` and emits `masterdata:updated` to the tenant so open screens refetch.',
      operationId: 'masterDataCreate',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('MasterItemWrite')),
      responses: {
        201: ok('Created', ref('MasterItemAny')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        409: {
          description: 'Name exists',
          content: json(ref('Error'), errorExample('CONFLICT', '"Powai" already exists', { fields: { name: 'Name already exists' } })),
        },
      },
    },
  },
  '/master-data/{kind}/order': {
    parameters: [kindParam],
    put: {
      tags: ['Master data'],
      summary: 'Drag-to-reorder: ids in the new order (ADMIN)',
      operationId: 'masterDataReorder',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(obj({ ids: arr({ type: 'integer' }, { minItems: 1, maxItems: 500 }) }, ['ids']), { ids: [1, 2, 3, 4, 5, 6] }),
      responses: { 200: ok('New order', obj({ data: arr(ref('MasterItemAny')) })), 400: resp('BadRequest'), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
  },
  '/master-data/{kind}/{id}': {
    parameters: [kindParam, idPath('Item id')],
    patch: {
      tags: ['Master data'],
      summary: 'Rename / deactivate / change stage (ADMIN)',
      description: 'A rename is visible in every property list immediately (cache cleared, H10).',
      operationId: 'masterDataUpdate',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('MasterItemWrite'), { name: 'Powai (Hiranandani)' }),
      responses: {
        200: ok('Updated', ref('MasterItemAny')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        409: { description: 'Name exists', content: json(ref('Error')) },
        422: resp('Unprocessable'),
      },
    },
    delete: {
      tags: ['Master data'],
      summary: 'Delete an unused item (ADMIN)',
      operationId: 'masterDataDelete',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: {
        204: { description: 'Deleted' },
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: {
          description: 'In use — deactivate instead',
          content: json(
            ref('Error'),
            errorExample('IN_USE', '"Apartment" is used by 7012 listings; deactivate it instead', { usedBy: 7012, suggestion: 'deactivate' }),
          ),
        },
      },
    },
  },
  '/team': {
    get: {
      tags: ['Users'],
      summary: 'Active users of the tenant (assignee picker, agent filter)',
      operationId: 'team',
      security: bearer,
      'x-roles': ['ADMIN', 'MANAGER'],
      responses: {
        200: ok('Team', obj({ data: arr(ref('TeamMember')) }), {
          data: [
            { id: 4, name: 'Riya Sharma', role: 'AGENT' },
            { id: 5, name: 'Kabir Singh', role: 'AGENT' },
          ],
        }),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
      },
    },
  },
  '/users': {
    get: {
      tags: ['Users'],
      summary: 'List tenant users (ADMIN)',
      description: proxied,
      operationId: 'crmListUsers',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: {
        200: ok('Users', obj({ data: arr(ref('PublicUser')) })),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        503: resp('ServiceUnavailable'),
      },
    },
  },
  '/users/{id}': {
    parameters: [idPath('User id')],
    get: {
      tags: ['Users'],
      summary: 'Get user (ADMIN)',
      description: proxied,
      operationId: 'crmGetUser',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: { 200: ok('User', ref('PublicUser')), 401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('NotFound') },
    },
    patch: {
      tags: ['Users'],
      summary: 'Change role / deactivate (ADMIN). Last ADMIN guarded (422).',
      description: proxied,
      operationId: 'crmUpdateUser',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('UpdateUserRequest')),
      responses: {
        200: ok('User', ref('PublicUser')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: { description: 'Last admin', content: json(ref('Error'), errorExample('LAST_ADMIN', 'The last active admin cannot be demoted or deactivated')) },
      },
    },
  },
  '/invites': {
    get: {
      tags: ['Users'],
      summary: 'List invites (ADMIN)',
      description: proxied,
      operationId: 'crmListInvites',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: { 200: ok('Invites', obj({ data: arr(ref('Invite')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
    post: {
      tags: ['Users'],
      summary: 'Invite a user (ADMIN)',
      description: proxied,
      operationId: 'crmCreateInvite',
      security: bearer,
      'x-roles': ['ADMIN'],
      requestBody: body(ref('InviteRequest')),
      responses: {
        201: ok('Invite', ref('InviteResponse')),
        400: resp('BadRequest'),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        409: { description: 'Email taken', content: json(ref('Error')) },
      },
    },
  },
  '/invites/{id}/link': {
    parameters: [idPath('Invite id')],
    get: {
      tags: ['Users'],
      summary: 'Copy link of a pending invite (ADMIN)',
      description: proxied,
      operationId: 'crmInviteLink',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: {
        200: ok('Link', ref('InviteResponse')),
        401: resp('Unauthorized'),
        403: resp('Forbidden'),
        404: resp('NotFound'),
        422: resp('Unprocessable'),
      },
    },
  },
  '/invites/{id}': {
    parameters: [idPath('Invite id')],
    delete: {
      tags: ['Users'],
      summary: 'Revoke invite (ADMIN)',
      description: proxied,
      operationId: 'crmRevokeInvite',
      security: bearer,
      'x-roles': ['ADMIN'],
      responses: { 200: ok('Invite', ref('Invite')), 401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('NotFound') },
    },
  },
  '/platform/tenant-stats': {
    get: {
      tags: ['Platform'],
      summary: 'Property counts per tenant (SUPER_ADMIN, counts only)',
      operationId: 'tenantStats',
      security: bearer,
      'x-roles': ['SUPER_ADMIN'],
      responses: { 200: ok('Counts', obj({ data: arr(ref('TenantStats')) })), 401: resp('Unauthorized'), 403: resp('Forbidden') },
    },
  },
};

// Socket.IO contract (not expressible as OpenAPI paths) — documented as an extension + in the description.
const socketEvents = {
  transport: 'Socket.IO v4 on the crm-api origin (path /socket.io). Redis adapter fans events out across instances.',
  handshake: { auth: { token: '<access token>' }, onError: 'connect_error with message UNAUTHENTICATED | TOKEN_EXPIRED | INVALID_TOKEN | FORBIDDEN_ROLE' },
  ack: 'Every client→server event takes an ack callback: { ok: true, ... } or { ok: false, error: { code, message, details? } }',
  clientToServer: {
    'auth:renew': { payload: { token: 'string' }, ack: { ok: true, exp: 1790000000 }, note: 'Swap in a fresh access token without reconnecting' },
    'property:join': {
      payload: { propertyId: 1699 },
      ack: { ok: true, room: 'property:1699' },
      note: 'Refused with NOT_FOUND unless the user may read the property (tenant + agent ownership)',
    },
    'property:leave': { payload: { propertyId: 1699 } },
    typing: { payload: { propertyId: 1699, isTyping: true }, note: 'Relayed to the rest of the room' },
    'chat:send': {
      payload: { propertyId: 1699, clientMsgId: 'c-01J9Z3K4', body: 'Owner confirmed Saturday 11 AM' },
      ack: { ok: true, id: 5521, createdAt: '2026-10-01T05:20:11.000Z', duplicate: false, message: 'ChatMessage' },
      note: 'Persisted before broadcast; a retry with the same clientMsgId acks the original row with duplicate=true and is not re-broadcast. An expired token acks TOKEN_EXPIRED: renew, then retry with the same clientMsgId.',
    },
  },
  serverToClient: {
    'chat:new': { room: 'property:{id}', payload: 'ChatMessage' },
    typing: { room: 'property:{id}', payload: { propertyId: 1699, user: { id: 4, name: 'Riya Sharma' }, isTyping: true } },
    presence: { room: 'property:{id}', payload: { propertyId: 1699, users: [{ id: 4, name: 'Riya Sharma' }] } },
    'note:new': { room: 'property:{id}', payload: 'Note' },
    'property:updated': {
      room: 'tenant:{tid}:staff + user:{assigneeId} + property:{id}',
      payload: { tenantId: 1, ids: [1699], action: 'updated', version: 5 },
    },
    'masterdata:updated': { room: 'tenant:{tid}', payload: { tenantId: 1, kind: 'localities' } },
    'visit:reminder': {
      room: 'user:{agentId}',
      payload: {
        visitId: 77,
        propertyId: 1699,
        propertyTitle: '2 BHK Apartment for sale in Powai',
        building: 'Hiranandani Gardens A Wing 1203',
        visitAt: '2026-10-01T04:30:00.000Z',
        minutesUntil: 15,
        visitorName: 'Amit Joshi',
      },
      note: 'From the every-minute cron; exactly once per visit across instances',
    },
    'visit:created': { room: 'user:{agentId}', payload: { id: 78, propertyId: 1699, visitAt: '2026-10-03T06:00:00.000Z' } },
  },
};

const socketMarkdown = `
### Real-time (Socket.IO)

Connect to the crm-api origin with \`io(CRM_URL, { auth: { token } })\`. Invalid or expired token → \`connect_error\`.

| Event | Direction | Payload | Rule |
|---|---|---|---|
| \`auth:renew\` | client → server | \`{ token }\` | Re-auth on expiry without reconnecting |
| \`property:join\` | client → server | \`{ propertyId }\` | Joins \`property:{id}\` only if the user may read it (else ack \`NOT_FOUND\`) |
| \`chat:send\` | client → server | \`{ propertyId, clientMsgId, body }\` | Ack \`{ ok, id, createdAt, duplicate }\`; persisted before broadcast; retries idempotent |
| \`typing\` | both | \`{ propertyId, isTyping }\` | Relayed to the room |
| \`chat:new\` / \`note:new\` / \`presence\` | server → room | message / note / users | < 1 s |
| \`property:updated\` | server → staff + assignee | \`{ ids, action, version }\` | Open tables refresh the row |
| \`masterdata:updated\` | server → tenant | \`{ kind }\` | Refetch master data |
| \`visit:reminder\` | server → user | visit summary | From cron, 15 min before, once |

Full machine-readable contract: the \`x-socket-io\` extension of this document.`;

// ─────────────────────────────── assemble ───────────────────────────────

const commonInfo = {
  version: '1.0.0',
  contact: { name: 'PropFlow', email: 'bionex.product@gmail.com' },
  license: { name: 'Proprietary — hiring assignment', url: 'https://github.com/your-github/propflow' },
};

const rbacMarkdown = `
### Roles (enforced by one \`authorize({ roles })\` middleware + a \`propertyScope()\` helper)

| Role | Scope |
|---|---|
| SUPER_ADMIN | Platform console only: tenants, counts, signing keys, security events. Never tenant data (403). |
| ADMIN | Everything in own tenant: users, invites, master data, all properties, export, dashboard. |
| MANAGER | All properties of the tenant, reassign, bulk, export, dashboard, team calendar. |
| AGENT | Only listings assigned to them. Others' ids → **404**. No export / bulk / dashboard / admin (403). |

Each operation lists its allowed roles in \`x-roles\`.

### Status codes
\`400\` validation · \`401\` missing/expired token · \`403\` wrong role · \`404\` not found **or not yours** · \`409\` version conflict / duplicate · \`422\` business rule · \`429\` rate limit · \`503\` dependency down.

### Error shape (everywhere)
\`\`\`json
{ "error": { "code": "VERSION_CONFLICT", "message": "…", "details": { } } }
\`\`\``;

const authDoc = {
  openapi: '3.0.3',
  info: {
    title: 'PropFlow auth-server',
    ...commonInfo,
    description: `Identity service for PropFlow. The **only** holder of private keys.

* **Access tokens:** RS256 JWT, 60 s in the deployed build, header \`kid\`, claims \`sub, tid, role, name, jti, iat, exp\`.
* **Refresh tokens:** opaque 256-bit, rotating, 7 days, httpOnly cookie \`pf_rt\`, stored hashed (SHA-256) in Redis and grouped by family; replaying a used token revokes the whole family.
* **JWKS:** \`/.well-known/jwks.json\` — at least two keys live across a rotation; crm-api verifies with it.
* **Login lockout:** 5 failures per IP + email → 15 min, 429 + \`Retry-After\`.
${rbacMarkdown}`,
  },
  servers: [
    { url: AUTH_URL_LOCAL, description: 'Local (npm run dev:auth / docker compose)' },
    { url: AUTH_URL_PROD, description: 'Railway (replace with your deployed URL)' },
  ],
  tags: [
    { name: 'Auth', description: 'Login, refresh rotation, logout, tenant sign-up' },
    { name: 'Invites', description: 'Signed single-use invite links (24 h)' },
    { name: 'Users', description: 'Tenant user administration (ADMIN)' },
    { name: 'Platform', description: 'SUPER_ADMIN console: tenants, keys, security events' },
    { name: 'System', description: 'Health and JWKS' },
  ],
  paths: authPaths,
  components: { securitySchemes, schemas: authSchemas, responses: sharedResponses, parameters: sharedParameters, headers: sharedHeaders },
};

const crmDoc = {
  openapi: '3.0.3',
  info: {
    title: 'PropFlow crm-api',
    ...commonInfo,
    description: `Properties, site visits, chat, master data, dashboard and export.

Every request runs through: **requestId + logger → authenticate (RS256 via JWKS) → tenantScope (\`req.tenantId = token.tid\`, never from body/query) → authorize (role) → validate (shared Zod) → controller → service → error handler**.
${rbacMarkdown}
${socketMarkdown}`,
  },
  servers: [
    { url: CRM_URL_LOCAL, description: 'Local (npm run dev:crm / docker compose; via nginx on :8080)' },
    { url: CRM_URL_PROD, description: 'Railway (replace with your deployed URL)' },
  ],
  tags: [
    { name: 'Properties', description: 'Listings: list/filter/sort, CRUD with optimistic locking, bulk, export' },
    { name: 'Notes & chat', description: 'Notes and chat history (live events over Socket.IO)' },
    { name: 'Site visits', description: 'Calendar; stored in UTC' },
    { name: 'Dashboard', description: 'Analytics (ADMIN, MANAGER)' },
    { name: 'Master data', description: 'Statuses, property types, localities, amenities' },
    { name: 'Users', description: 'Team directory; /users and /invites forwarded to auth-server' },
    { name: 'Platform', description: 'SUPER_ADMIN counts' },
    { name: 'System', description: 'Health' },
  ],
  paths: crmPaths,
  components: {
    securitySchemes: { bearerAuth: securitySchemes.bearerAuth },
    schemas: crmSchemas,
    responses: crmResponses,
    parameters: sharedParameters,
    headers: sharedHeaders,
  },
  'x-socket-io': socketEvents,
};

// Combined document: every path carries its own `servers`, so "Try it out" hits the right service.
// Paths present on both services (/health, /users, /invites…) are listed under /crm-api/… for crm-api.
const combinedPaths = {};
for (const [p, item] of Object.entries(authPaths)) combinedPaths[p] = { ...item, servers: authDoc.servers };
for (const [p, item] of Object.entries(crmPaths)) {
  if (!combinedPaths[p]) {
    combinedPaths[p] = { ...item, servers: crmDoc.servers };
    continue;
  }
  combinedPaths[`/crm-api${p}`] = {
    ...item,
    description: `Served by crm-api at \`${p}\` — call it **without** the /crm-api prefix (the prefix only keeps this combined document valid).`,
    servers: crmDoc.servers,
  };
}
const combined = {
  openapi: '3.0.3',
  info: {
    title: 'PropFlow API (auth-server + crm-api)',
    ...commonInfo,
    description: `Both PropFlow services in one document. Each path carries its own \`servers\` entry, so Swagger UI sends it to the right service. Paths that exist on both services (\`/health\`, \`/users\`, \`/invites\`) appear once for auth-server and under a \`/crm-api\` prefix for crm-api — call crm-api without that prefix.

Per-service documents (served at \`/docs\` and \`/swagger.json\` by each service): \`apps/auth-server/swagger.json\`, \`apps/crm-api/swagger.json\`.
${rbacMarkdown}
${socketMarkdown}`,
  },
  servers: [...authDoc.servers, ...crmDoc.servers],
  tags: [...authDoc.tags, ...crmDoc.tags.filter((t) => !authDoc.tags.some((a) => a.name === t.name))],
  paths: combinedPaths,
  components: {
    securitySchemes,
    schemas: { ...authSchemas, ...crmSchemas },
    responses: sharedResponses,
    parameters: sharedParameters,
    headers: sharedHeaders,
  },
  'x-socket-io': socketEvents,
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Every operation: explicit security (public = []), X-Request-Id in and out. */
function finalize(doc) {
  for (const item of Object.values(doc.paths)) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      if (!op.security) op.security = [];
      op.parameters = [param('XRequestId'), ...(op.parameters ?? [])];
      for (const r of Object.values(op.responses)) {
        if (r.$ref) continue;
        r.headers = { 'X-Request-Id': { $ref: '#/components/headers/X-Request-Id' }, ...(r.headers ?? {}) };
      }
    }
  }
  return doc;
}

const write = (file, input) => {
  const doc = finalize(structuredClone(input)); // docs share path objects; never mutate the originals
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(doc, null, 2)}\n`);
  const ops = Object.values(doc.paths).reduce(
    (n, item) => n + Object.keys(item).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length,
    0,
  );
  console.log(`wrote ${file}: ${Object.keys(doc.paths).length} paths, ${ops} operations, ${Object.keys(doc.components.schemas).length} schemas`);
};

write('apps/auth-server/swagger.json', authDoc);
write('apps/crm-api/swagger.json', crmDoc);
write('swagger.json', combined);
