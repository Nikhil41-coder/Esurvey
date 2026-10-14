import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openStore } from './lib/store.mjs';
import { annotate, validateTree } from './lib/tree.mjs';
const derive = promisify(scrypt), root = fileURLToPath(new URL('.', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });
export function createApplication({ database = resolve(root, 'data/family.sqlite'), secure = process.env.NODE_ENV === 'production' } = {}) {
  const db = openStore(database);
  const staticFiles = { '/': ['public/index.html', 'text/html'], '/app': ['public/app.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/app.css': ['public/app.css', 'text/css'], '/auth.js': ['public/auth.js', 'text/javascript'], '/tree.mjs': ['lib/tree.mjs', 'text/javascript'] };
  const prepared = Object.fromEntries(Object.entries(staticFiles).map(([url, [file, type]]) => [url, { body: readFileSync(resolve(root, file)), type }]));
  const cookie = (token, age) => `family_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  function session(req) {
    const token = /(?:^|;\s*)family_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return db.prepare('SELECT s.*,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires>?').get(hash(token), Date.now());
  }
  function json(res, status, data, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data)); }
  async function body(req) {
    let data = '', size = 0;
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw httpError(415, 'Send JSON data.');
    for await (const chunk of req) { size += chunk.length; if (size > 32768) throw httpError(413, 'Request is too large.'); data += chunk; }
    try { const result = JSON.parse(data); if (!result || typeof result !== 'object' || Array.isArray(result)) throw 0; return result; } catch { throw httpError(400, 'Invalid request data.'); }
  }
  function text(input, field, required = false, limit = 120) {
    const value = input[field];
    if (value != null && typeof value !== 'string') throw httpError(400, `Invalid ${field}.`);
    const trimmed = (value || '').trim();
    if ((required && !trimmed) || trimmed.length > limit) throw httpError(400, `Enter ${field} (${required ? '1–' : 'up to '}${limit} characters).`);
    return trimmed;
  }
  function person(input, id) {
    const name = text(input, 'name', true), place = text(input, 'place', true), doorNumber = text(input, 'doorNumber', true, 40), occupation = text(input, 'occupation', false), notes = text(input, 'notes', false, 1000);
    const age = input.age === '' || input.age == null ? null : Number(input.age);
    if (age !== null && (!Number.isInteger(age) || age < 0 || age > 125)) throw httpError(400, 'Age must be a whole number from 0 to 125.');
    if (!['male', 'female', 'other'].includes(input.gender)) throw httpError(400, 'Select a gender or neutral relationship labels.');
    const secondParent = text(input, 'secondParent', false, 36) || null;
    return { id, name, place, doorNumber, age, occupation, notes, gender: input.gender, relativeTo: input.relativeTo || null, connection: input.relativeTo ? input.connection : null, secondParent };
  }
  function family(user) { return db.prepare('SELECT * FROM families WHERE user_id=?').get(user.user_id); }
  function save(user, members, revision) {
    if (!Number.isInteger(revision) || revision < 0) throw httpError(400, 'Provide a valid family revision.');
    try { validateTree(members); } catch (e) { throw httpError(400, e.message); }
    const result = db.prepare('UPDATE families SET members=?,revision=revision+1 WHERE user_id=? AND revision=?').run(JSON.stringify(members), user.user_id, revision);
    if (!result.changes) throw httpError(409, 'This family changed in another window. Refresh and try again.');
    return { members: annotate(members), revision: revision + 1 };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname, user = session(req);
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.headers.origin;
        const expected = secure ? process.env.APP_ORIGIN : `http://${req.headers.host}`;
        if (secure && !expected) throw httpError(503, 'Set APP_ORIGIN for production.');
        if (origin && origin !== expected) throw httpError(403, 'Request origin is not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Cross-site request blocked.');
      }
      if (req.method === 'GET' && path === '/api/session') { json(res, 200, user ? { authenticated: true, user: { name: user.name, email: user.email }, csrf: user.csrf } : { authenticated: false }); return; }
      if (req.method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
        const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
        const attempt = db.prepare('SELECT * FROM auth_attempts WHERE ip=?').get(ip);
        if (attempt && attempt.reset_at > now && attempt.attempts >= 15) throw httpError(429, 'Too many attempts. Please try again in 15 minutes.');
        db.prepare('INSERT INTO auth_attempts(ip,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET attempts=CASE WHEN reset_at>? THEN attempts+1 ELSE 1 END,reset_at=CASE WHEN reset_at>? THEN reset_at ELSE ? END').run(ip, now + 900000, now, now, now + 900000);
        const input = await body(req), email = text(input, 'email', true, 254).toLowerCase(), password = input.password;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
        if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw httpError(400, 'Use a password of 10–128 characters.');
        let account = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (path === '/api/register') {
          const name = text(input, 'name', true);
          if (account) throw httpError(409, 'An account with this email already exists. Sign in instead.');
          const salt = randomBytes(16).toString('hex'), passwordHash = (await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
          const id = randomUUID();
          db.exec('BEGIN');
          try { db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id, email, name, salt, passwordHash); db.prepare('INSERT INTO families(user_id) VALUES(?)').run(id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); if (String(e.message).includes('UNIQUE')) throw httpError(409, 'This account already exists.'); throw e; }
          account = { id, name, email };
        } else {
          const computed = await derive(password, account?.salt || '00000000000000000000000000000000', 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
          if (!account || !timingSafeEqual(Buffer.from(account.password_hash, 'hex'), computed)) throw httpError(401, 'Email or password is incorrect.');
        }
        if (user) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash);
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token), account.id, csrf, now + 8 * 3600000);
        db.prepare('DELETE FROM auth_attempts WHERE ip=?').run(ip);
        json(res, 200, { user: { name: account.name, email }, csrf }, { 'Set-Cookie': cookie(token, 8 * 3600) }); return;
      }
      if (path.startsWith('/api/')) {
        if (!user) throw httpError(401, 'Please sign in to continue.');
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== user.csrf) throw httpError(403, 'Session verification failed. Refresh and try again.');
        if (path === '/api/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.token_hash); json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); return; }
        const record = family(user), members = JSON.parse(record.members);
        if (path === '/api/family' && req.method === 'GET') { json(res, 200, { members: annotate(members), revision: record.revision }); return; }
        if (path === '/api/export' && req.method === 'GET') { json(res, 200, { format: 'e-survey-family-v1', members: annotate(members) }, { 'Content-Disposition': 'attachment; filename="family-tree.json"' }); return; }
        if (path === '/api/members' && req.method === 'POST') {
          const input = await body(req), p = person(input, randomUUID());
          if (members.length && !p.relativeTo) throw httpError(400, 'Select who this person is related to.');
          if (!members.length && p.relativeTo) throw httpError(400, 'The first person is the head of family.');
          json(res, 201, save(user, [...members, p], input.revision)); return;
        }
        const match = /^\/api\/members\/([a-f0-9-]{36})$/.exec(path);
        if (match && ['PATCH', 'DELETE'].includes(req.method)) {
          const target = members.find(p => p.id === match[1]); if (!target) throw httpError(404, 'Member not found.');
          const input = await body(req);
          if (req.method === 'DELETE') {
            if (members.some(p => p.relativeTo === target.id || p.secondParent === target.id)) throw httpError(409, 'This member connects other people. Reconnect or remove those people first.');
            json(res, 200, save(user, members.filter(p => p.id !== target.id), input.revision)); return;
          }
          const updated = person(input, target.id);
          if (!target.relativeTo && updated.relativeTo || target.relativeTo && !updated.relativeTo) throw httpError(400, 'The head of family cannot be changed here.');
          json(res, 200, save(user, members.map(p => p.id === target.id ? updated : p), input.revision)); return;
        }
        throw httpError(404, 'Endpoint not found.');
      }
      if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
      if (path === '/app' && !user) { res.writeHead(302, { Location: '/' }); res.end(); return; }
      if (path === '/' && user) { res.writeHead(302, { Location: '/app' }); res.end(); return; }
      const asset = prepared[path]; if (!asset) throw httpError(404, 'Page not found.');
      res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); res.end(asset.body);
    } catch (e) { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong. Please try again.' }); else res.end(); if (!e.status) console.error(e); }
  });
  server.requestTimeout = 15000;
  return { server, db };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 49321), host = process.env.HOST || '127.0.0.1';
  const app = createApplication({ database: process.env.DB_PATH || resolve(root, 'data/family.sqlite') });
  app.server.listen(port, host, () => console.log(`E-Survey Family Tree: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.server.close(() => { app.db.close(); process.exit(0); }));
}
