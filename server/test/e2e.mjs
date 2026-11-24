#!/usr/bin/env node
/**
 * End-to-end tests against the TEST Worker only (never production).
 * Usage: node e2e.mjs [https://house-ranking-test.nikkukyuu.workers.dev]
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'https://house-ranking-test.nikkukyuu.workers.dev';
if (/house-ranking\.nikkukyuu\.workers\.dev/.test(BASE) && !/house-ranking-test/.test(BASE)) {
  console.error('Refusing to run tests against production');
  process.exit(2);
}
const ORIGIN = 'http://localhost:8080';
let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log('OK  ', name);
  else { console.log('FAIL', name, extra || ''); failed++; }
}

async function call(path, { method = 'GET', body, headers = {}, now } = {}) {
  const h = { Origin: ORIGIN, ...headers };
  if (body) h['Content-Type'] = 'application/json';
  if (now) h['X-Test-Now'] = String(now);
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

function seal(token, payload) {
  const r = spawnSync('node', [join(ROOT, 'sealcli.mjs'), token, JSON.stringify(payload)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('sealcli failed: ' + (r.stderr || r.stdout));
  return JSON.parse(r.stdout);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nick = 'HH試験' + Date.now().toString(36).slice(-5);

const health = await call('/health');
ok('health', health.j.ok && health.j.service === 'house-ranking', health.j);

const reg = await call('/register', { method: 'POST', body: { nickname: nick } });
ok('register', reg.j.ok && /^h[0-9a-f]{24}$/.test(reg.j.id) && reg.j.secret, reg.j);
const { id, secret } = reg.j;
const nick2 = await call('/register', { method: 'POST', body: { nickname: nick } });
ok('duplicate nick adjusted', nick2.j.ok && nick2.j.adjusted && nick2.j.nickname !== nick, nick2.j);

const me = await call('/me', { method: 'POST', body: { id, secret } });
ok('me', me.j.ok && me.j.id === id, me.j);
const badMe = await call('/me', { method: 'POST', body: { id, secret: 'nope' } });
ok('bad auth', !badMe.j.ok && badMe.status === 401, badMe);

async function play(won, ms, { wait, late = false } = {}) {
  const st = await call('/match/start', { method: 'POST', body: { id, secret } });
  if (!st.j.ok) return { start: st };
  // Server requires wall >= MIN_WALL_MS (500) and, for wins, ms <= wall + 2000.
  const pause = wait != null ? wait : (won ? Math.max(650, ms - 1500) : 650);
  if (pause) await sleep(pause);
  const sealed = seal(st.j.token, { s: ms, w: won ? 1 : 0 });
  const sub = await call('/match/submit', { method: 'POST', body: { id, secret, token: st.j.token, ...sealed, late } });
  return { start: st, sub };
}

// too fast wall
const fast = await play(true, 800, { wait: 0 });
ok('reject too-fast wall', !fast.sub.j.ok && fast.sub.j.error === 'fast', fast.sub.j);

// wait then implausibly fast search time
const cap = await play(true, 50, { wait: 650 });
ok('reject implausible ms', !cap.sub.j.ok && cap.sub.j.error === 'cap', cap.sub.j);

// forged / unsealed
{
  const st = await call('/match/start', { method: 'POST', body: { id, secret } });
  await sleep(650);
  const plain = await call('/match/submit', { method: 'POST', body: { id, secret, token: st.j.token, s: 4000, w: 1 } });
  ok('reject unsealed', !plain.j.ok && plain.j.error === 'seal', plain.j);
  const sealed = seal(st.j.token, { s: 4000, w: 1 });
  sealed.ct = Buffer.from(sealed.ct, 'base64');
  const buf = Buffer.from(sealed.ct);
  if (buf.length) buf[3] ^= 1;
  sealed.ct = buf.toString('base64');
  const tam = await call('/match/submit', { method: 'POST', body: { id, secret, token: st.j.token, ...sealed } });
  ok('reject tampered', !tam.j.ok && tam.j.error === 'seal', tam.j);
}

// token reuse
{
  const a = await play(true, 4000);
  ok('first win accepted', a.sub.j.ok && a.sub.j.won && a.sub.j.streak >= 1, a.sub.j);
  const replay = await call('/match/submit', { method: 'POST', body: { id, secret, token: a.start.j.token, ...seal(a.start.j.token, { s: 4000, w: 1 }) } });
  ok('reject reused token', !replay.j.ok && (replay.j.error === 'token' || replay.status === 409), replay.j);
}

// Reset streak so the 3-win window is exactly w1+w2+w3.
const reset = await play(false, 800);
ok('reset streak before window', reset.sub.j.ok && reset.sub.j.streak === 0, reset.sub.j);

// 3 consecutive wins → record
const w1 = await play(true, 5000);
const w2 = await play(true, 6000);
const w3 = await play(true, 7000);
ok('win1', w1.sub.j.ok && w1.sub.j.streak >= 1, w1.sub.j);
ok('win2 no window yet', w2.sub.j.ok && w2.sub.j.streak >= 2 && w2.sub.j.windowMs == null, w2.sub.j);
ok('win3 window 18000', w3.sub.j.ok && w3.sub.j.streak >= 3 && w3.sub.j.windowMs === 18000 && w3.sub.j.updated && w3.sub.j.best === 18000, w3.sub.j);
ok('win3 has rank', w3.sub.j.ok && w3.sub.j.rank >= 1, w3.sub.j);

const board = await call(`/ranking?period=alltime&id=${id}`);
ok('alltime lists us', board.j.ok && board.j.me && board.j.me.ms === 18000, board.j);
ok('alltime ordered lower-ms first', board.j.ok && board.j.top.length >= 1 && board.j.top[0].ms <= 18000, board.j.top && board.j.top[0]);

// rolling: 4th win 3000 → last3 = 6000+7000+3000=16000 better
const w4 = await play(true, 3000);
ok('rolling better 16000', w4.sub.j.ok && w4.sub.j.windowMs === 16000 && w4.sub.j.updated && w4.sub.j.best === 16000, w4.sub.j);

// worse window should not update best
const w5 = await play(true, 20000);
// last3 = 7000+3000+20000 = 30000; personal best stays 16000
ok('worse window ms 30000 not pb', w5.sub.j.ok && w5.sub.j.windowMs === 30000 && w5.sub.j.updated === false && w5.sub.j.best === 16000, w5.sub.j);

// loss resets streak
const loss = await play(false, 8000);
ok('loss resets streak', loss.sub.j.ok && loss.sub.j.won === false && loss.sub.j.streak === 0, loss.sub.j);
const after = await play(true, 4000);
ok('streak restarts at 1', after.sub.j.ok && after.sub.j.streak === 1 && after.sub.j.windowMs == null, after.sub.j);

const week = await call(`/ranking?period=week&id=${id}`);
ok('week board has us', week.j.ok && week.j.me && week.j.me.ms === 16000, week.j);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
