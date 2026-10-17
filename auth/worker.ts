// Authentication and shared settings only. Public GitHub library assets remain public.
const encoder = new TextEncoder();
const ITERATIONS = 100_000;
const SESSION_SECONDS = 12 * 60 * 60;
type Account = { id: 'team' | 'admin'; username: string; salt: string; password_hash: string; version: number; updated_at: number };
type Session = Account & { expires_at: number; token_hash: string };
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hex = (buffer: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
const bytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], part => parseInt(part, 16));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: bytes(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256));
}
async function matches(password: string, account: Account) {
  return crypto.subtle.timingSafeEqual(await passwordHash(password, account.salt), bytes(account.password_hash));
}
function passwordValid(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 4 && value.length <= 128 && value.trim().length > 0;
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON 형식으로 요청해 주세요.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '입력값을 확인해 주세요.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new HttpError(413, '입력값이 너무 깁니다.'); }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(buffer));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '입력값을 확인해 주세요.');
  } finally { reader.releaseLock(); }
}
async function limit(db: D1Database, request: Request, kind: string, now: number) {
  const key = await sha(kind + ':' + (request.headers.get('CF-Connecting-IP') || 'local'));
  const start = Math.floor(now / 60) * 60;
  const row = await db.prepare(`INSERT INTO attempts(key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
    window_start = excluded.window_start RETURNING count`).bind(key, start).first<{ count: number }>();
  if (!row || row.count > (kind === 'login' ? 15 : 8)) throw new HttpError(429, '시도가 많습니다. 1분 뒤 다시 시도해 주세요.');
}
async function session(db: D1Database, request: Request, now: number): Promise<Session> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new HttpError(401, '다시 로그인해 주세요.');
  // Direct D1 queries always use the primary; password changes cannot read stale replicas.
  const row = await db.prepare(`SELECT a.*, s.expires_at, s.token_hash FROM sessions s
    JOIN accounts a ON a.id = s.account_id AND a.version = s.version
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await sha(token), now).first<Session>();
  if (!row) throw new HttpError(401, '로그인이 만료되었거나 비밀번호가 변경되었습니다. 다시 로그인해 주세요.');
  return row;
}
const publicAccount = (account: Account) => ({ username: account.username, role: account.id });
async function route(request: Request, env: Env) {
  const path = new URL(request.url).pathname, now = Math.floor(Date.now() / 1000), db = env.DB;
  if (path === '/login' && request.method === 'POST') {
    await limit(db, request, 'login', now);
    const body = await readBody(request);
    if (typeof body.username !== 'string' || body.username.length > 80 || !passwordValid(body.password)) throw new HttpError(400, '아이디 또는 비밀번호를 확인해 주세요.');
    const username = body.username.normalize('NFC').trim();
    const account = await db.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first<Account>();
    if (!account || !await matches(body.password, account)) throw new HttpError(401, '아이디 또는 비밀번호를 확인해 주세요.');
    const token = random(), tokenHash = await sha(token), expiresAt = now + SESSION_SECONDS;
    const result = await db.prepare(`INSERT INTO sessions(token_hash, account_id, version, expires_at)
      SELECT ?, id, version, ? FROM accounts WHERE id = ? AND version = ?`)
      .bind(tokenHash, expiresAt, account.id, account.version).run();
    if (result.meta.changes !== 1) throw new HttpError(401, '비밀번호가 변경되었습니다. 다시 로그인해 주세요.');
    // Bound old session and rate-limit storage on successful logins.
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
      db.prepare('DELETE FROM attempts WHERE window_start < ?').bind(now - 3600)
    ]);
    return { token, expiresAt, ...publicAccount(account) };
  }
  if (path === '/logout' && request.method === 'POST') {
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(token)).run();
    return { ok: true };
  }
  if (!((path === '/session' && request.method === 'GET') || (path === '/admin/password' && ['GET', 'POST'].includes(request.method)))) throw new HttpError(404, '요청을 찾을 수 없습니다.');
  const user = await session(db, request, now);
  if (path === '/session') return { ...publicAccount(user), expiresAt: user.expires_at };
  if (user.id !== 'admin') throw new HttpError(403, '관리자만 변경할 수 있습니다.');
  if (request.method === 'GET') {
    const team = await db.prepare("SELECT username, version, updated_at AS updatedAt FROM accounts WHERE id = 'team'").first();
    return { team };
  }
  await limit(db, request, 'change', now);
  const body = await readBody(request);
  if (!passwordValid(body.adminPassword) || !passwordValid(body.newPassword) || !Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new HttpError(400, '비밀번호는 공백만 사용하지 않고 4~128자로 입력해 주세요.');
  if (!await matches(body.adminPassword, user)) throw new HttpError(403, '관리자 비밀번호가 맞지 않습니다.');
  const salt = random(), hash = hex(await passwordHash(body.newPassword, salt));
  // Compare-and-swap prevents two administrator tabs from overwriting each other.
  // Recheck the admin session in the same write to reject logout/expiry during hashing.
  const changed = await db.prepare(`UPDATE accounts SET salt = ?, password_hash = ?, version = version + 1, updated_at = ?
    WHERE id = 'team' AND version = ? AND EXISTS (
      SELECT 1 FROM sessions s JOIN accounts a ON a.id = s.account_id AND a.version = s.version
      WHERE s.token_hash = ? AND a.id = 'admin' AND s.expires_at > ?)
    RETURNING username, version, updated_at AS updatedAt`)
    .bind(salt, hash, now, Number(body.version), user.token_hash, Math.floor(Date.now() / 1000)).first();
  if (!changed) throw new HttpError(409, '다른 화면에서 변경했거나 로그인이 만료되었습니다. 관리자 화면을 다시 열어 주세요.');
  return { ok: true, team: changed };
}
export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get('origin');
    const allowed = origin === env.ALLOWED_ORIGIN;
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' });
    if (allowed) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (origin && !allowed) return new Response(JSON.stringify({ error: '허용되지 않은 주소입니다.' }), { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try { return new Response(JSON.stringify(await route(request, env)), { headers }); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      if (status === 429) headers.set('Retry-After', '60');
      if (status === 503) console.error(JSON.stringify({ event: 'auth_unavailable', path: new URL(request.url).pathname }));
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : '로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }), { status, headers });
    }
  }
} satisfies ExportedHandler<Env>;
