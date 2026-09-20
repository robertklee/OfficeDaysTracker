import { z } from 'zod';
import { loginSchema, signupSchema, type User } from '../src/data/account-schema';
import {
  actionSchema,
  applyAction,
  ConflictError,
  editActionSchema,
  emptySnapshot,
  snapshotSchema,
} from '../src/data/model';
import { hashPassword, verifyPassword } from './password';

export interface Env {
  DB: D1Database;
}
const COOKIE = 'rto_planner_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_PLANNER_BYTES = 1_500_000;
const encoder = new TextEncoder();
const mutationSchema = z
  .object({
    id: z.string().uuid(),
    action: actionSchema,
  })
  .strict()
  .superRefine(({ action }, context) => {
    if (
      action.type === 'edit' &&
      (new Set(action.changes.map((change) => change.date)).size !== action.changes.length ||
        action.changes.some((change) => change.value && change.value.date !== change.date))
    )
      context.addIssue({ code: 'custom', message: 'Each edit must have a unique, matching date.' });
  });

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}

async function body(request: Request, limit: number): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new HttpError(415, 'Send application/json.');
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, 'Request exceeds the size limit.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Request exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sessionToken(request: Request): string | null {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function cookie(request: Request, token: string, maxAge = SESSION_SECONDS): string {
  const url = new URL(request.url);
  const local =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
}

async function newSession(db: D1Database, userId: string, now: number) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    token,
    statement: db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await digest(token), userId, now + SESSION_SECONDS),
  };
}

async function currentUser(db: D1Database, request: Request, now: number): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await digest(token), now)
    .first<User>();
}

async function requireUser(db: D1Database, request: Request, now: number): Promise<User> {
  const user = await currentUser(db, request, now);
  if (!user)
    throw new HttpError(
      401,
      'Your session expired. Export unsaved changes before signing in again.',
    );
  if (request.headers.get('x-rto-account') !== user.id)
    throw new HttpError(
      409,
      'The account changed in another tab. Reload before accessing account data.',
    );
  return user;
}

async function cleanup(db: D1Database, now: number) {
  await db.batch([
    db
      .prepare(
        'DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? LIMIT 100)',
      )
      .bind(now),
    db
      .prepare(
        'DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at <= ? LIMIT 100)',
      )
      .bind(now),
  ]);
}

async function rateLimit(db: D1Database, key: string, max: number, seconds: number, now: number) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts, expires_at`,
    )
    .bind(key, now + seconds, now, now)
    .first<{ attempts: number; expires_at: number }>();
  if (!row) throw new Error('Rate limiter did not return a result.');
  if (row.attempts > max)
    throw new HttpError(429, 'Too many attempts. Try again later.', row.expires_at - now);
}

type PlannerRow = {
  snapshot_json: string;
  revision: number;
  last_mutation_id: string | null;
  last_mutation_hash: string | null;
  last_inverse_json: string | null;
};
async function plannerRow(db: D1Database, id: string): Promise<PlannerRow> {
  const row = await db
    .prepare(
      `SELECT snapshot_json, revision, last_mutation_id,
    last_mutation_hash, last_inverse_json FROM planners WHERE user_id = ?`,
    )
    .bind(id)
    .first<PlannerRow>();
  if (!row) throw new Error('Account planner is missing.');
  return row;
}

function stored<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, serialized: string): T {
  const parsed = schema.safeParse(JSON.parse(serialized));
  if (!parsed.success) throw new Error('Stored account data failed validation.');
  return parsed.data;
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const method = request.method;
  const now = Math.floor(Date.now() / 1000);
  try {
    if (method !== 'GET' && request.headers.get('origin') !== new URL(request.url).origin)
      throw new HttpError(403, 'Account changes require an exact same-origin request.');
    const routes: Record<string, string[]> = {
      '/api/health': ['GET'],
      '/api/session': ['GET'],
      '/api/planner': ['GET', 'POST'],
      '/api/auth/signup': ['POST'],
      '/api/auth/login': ['POST'],
      '/api/auth/logout': ['POST'],
    };
    if (!routes[path]) throw new HttpError(404, 'API endpoint not found.');
    if (!routes[path].includes(method))
      return json({ error: 'Method not allowed.' }, 405, { Allow: routes[path].join(', ') });
    if (!env.DB) throw new Error('D1 DB binding is missing.');
    const db = env.DB;
    if (path === '/api/health') {
      await db.batch([
        db.prepare(
          'SELECT id, username, display_name, password_hash, created_at FROM users LIMIT 0',
        ),
        db.prepare('SELECT token_hash, user_id, expires_at FROM sessions LIMIT 0'),
        db.prepare('SELECT key, attempts, expires_at FROM rate_limits LIMIT 0'),
        db.prepare(
          'SELECT user_id, revision, snapshot_json, last_mutation_id, last_mutation_hash, last_inverse_json FROM planners LIMIT 0',
        ),
      ]);
      return json({ ready: true });
    }
    if (path === '/api/session') {
      // Query even without a cookie so an uninitialized service is not reported as healthy.
      await db.prepare('SELECT id FROM users LIMIT 0').all();
      return json({ user: await currentUser(db, request, now) });
    }
    if (path === '/api/auth/signup' || path === '/api/auth/login') {
      await cleanup(db, now);
      const signup = path.endsWith('/signup');
      const ip = await digest(request.headers.get('cf-connecting-ip') ?? 'local');
      await rateLimit(
        db,
        `${signup ? 'signup' : 'login'}:ip:${ip}`,
        signup ? 5 : 20,
        signup ? 3600 : 900,
        now,
      );
      const input = await body(request, 4096);
      const credentials = (signup ? signupSchema : loginSchema).parse(input);
      await rateLimit(db, `auth:username:${await digest(credentials.username)}`, 10, 900, now);
      if (signup) {
        const { displayName } = signupSchema.parse(input);
        const user: User = { id: crypto.randomUUID(), username: credentials.username, displayName };
        const passwordHash = await hashPassword(credentials.password);
        const session = await newSession(db, user.id, now);
        try {
          await db.batch([
            db
              .prepare(
                'INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
              )
              .bind(user.id, user.username, user.displayName, passwordHash, now),
            session.statement,
            db
              .prepare('INSERT INTO planners (user_id, snapshot_json) VALUES (?, ?)')
              .bind(user.id, JSON.stringify(emptySnapshot())),
          ]);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes('UNIQUE constraint failed: users.username')
          )
            throw new HttpError(409, 'That username is already in use.');
          throw error;
        }
        return json({ user }, 201, { 'Set-Cookie': cookie(request, session.token) });
      }
      const row = await db
        .prepare(
          'SELECT id, username, display_name AS displayName, password_hash FROM users WHERE username = ?',
        )
        .bind(credentials.username)
        .first<User & { password_hash: string }>();
      const valid = await verifyPassword(credentials.password, row?.password_hash ?? null);
      if (!row || !valid) throw new HttpError(401, 'Incorrect username or password.');
      const session = await newSession(db, row.id, now);
      await session.statement.run();
      const user: User = { id: row.id, username: row.username, displayName: row.displayName };
      return json({ user }, 200, { 'Set-Cookie': cookie(request, session.token) });
    }
    if (path === '/api/auth/logout') {
      z.object({})
        .strict()
        .parse(await body(request, 1024));
      const user = await currentUser(db, request, now);
      if (user && request.headers.get('x-rto-account') !== user.id)
        throw new HttpError(409, 'The account changed in another tab. Reload before signing out.');
      const token = sessionToken(request);
      if (token)
        await db
          .prepare('DELETE FROM sessions WHERE token_hash = ?')
          .bind(await digest(token))
          .run();
      return json({ user: null }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    }
    const user = await requireUser(db, request, now);
    if (method === 'GET')
      return json({
        snapshot: stored(snapshotSchema, (await plannerRow(db, user.id)).snapshot_json),
      });
    await cleanup(db, now);
    await rateLimit(db, `write:${user.id}`, 120, 60, now);
    const mutation = mutationSchema.parse(await body(request, 2 * 1024 * 1024));
    const mutationHash = await digest(JSON.stringify(mutation.action));
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await plannerRow(db, user.id);
      const current = stored(snapshotSchema, row.snapshot_json);
      if (row.last_mutation_id === mutation.id) {
        if (row.last_mutation_hash !== mutationHash)
          throw new HttpError(409, 'A retry cannot change the original edit.');
        return json({
          snapshot: current,
          inverse: stored(editActionSchema.nullable(), row.last_inverse_json ?? 'null'),
        });
      }
      const { snapshot, inverse } = applyAction(current, mutation.action);
      const serialized = JSON.stringify(snapshot);
      const inverseJSON = JSON.stringify(inverse);
      if (
        encoder.encode(serialized).byteLength + encoder.encode(inverseJSON).byteLength >
        MAX_PLANNER_BYTES
      )
        throw new HttpError(
          413,
          'Account storage is limited to 1.5 MB including revision and undo metadata. Export a backup and reduce the dataset, or use the local planner.',
        );
      // A compare-and-swap preserves the same per-date conflicts and atomic replacement as IndexedDB.
      const result = await db
        .prepare(
          `UPDATE planners SET snapshot_json = ?, revision = ?,
        last_mutation_id = ?, last_mutation_hash = ?, last_inverse_json = ?
        WHERE user_id = ? AND revision = ?`,
        )
        .bind(
          serialized,
          snapshot.revision,
          mutation.id,
          mutationHash,
          inverseJSON,
          user.id,
          row.revision,
        )
        .run();
      if (result.meta.changes === 1) return json({ snapshot, inverse });
    }
    throw new ConflictError();
  } catch (error) {
    if (error instanceof HttpError)
      return json(
        { error: error.message },
        error.status,
        error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {},
      );
    if (error instanceof ConflictError) return json({ error: error.message }, 409);
    if (error instanceof z.ZodError)
      return json({ error: 'Invalid request. Check the field formats and limits.' }, 400);
    console.error('Account service failure', {
      path,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      setupFailure:
        error instanceof Error
          ? error.message.match(
              /(?:no such (?:table|column): [\w.]+|D1 DB binding is missing|Unsupported stored password hash version|Stored account data failed validation|Account planner is missing)/,
            )?.[0]
          : undefined,
    });
    return json(
      {
        error:
          'Account service unavailable. Check the D1 binding and migrations, or try again later.',
      },
      503,
    );
  }
}
