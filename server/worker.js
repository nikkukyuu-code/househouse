// house-ranking — トリックハウスバトル online ranking (Cloudflare Worker + D1).
// Record: sum of search times (exploration start → match end) over any 3 consecutive
// COM wins in the current streak. Lower ms is better. Human-vs-human matches are never submitted.
const ORIGINS = ['https://nikkukyuu-code.github.io'];
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MIN_MS = 200;                 // client-measured search time floor per win
const MIN_WALL_MS = 500;            // server-measured token age floor
const MAX_TOKEN_AGE_SEC = 6 * 3600;
const LATE_MAX_AGE_SEC = 48 * 3600;
let SEAL_SECRET = 'SET_AT_DEPLOY'; // real value is a Worker secret (SEAL_SECRET), also embedded obfuscated in the client
const TOKENS_PER_HOUR_PLAYER = 40;
const TOKENS_PER_HOUR_IP = 80;
const REGISTER_PER_HOUR_IP = 10;
const TOP = 100;
const TYPES = ['day', 'week', 'month', 'year'];
const JST = 9 * 3600 * 1000;
// All-time board opens at 2026-11-25 00:00:00 Asia/Tokyo.
export const ALLTIME_START_MS = Date.UTC(2026, 10, 24, 15, 0, 0);

// Prefixed so prod tables can share the stb-ranking D1 without colliding.
const T = {
  players: 'house_players',
  tokens: 'house_tokens',
  wins: 'house_wins',
  scores: 'house_scores',
  bests: 'house_bests',
  medals: 'house_medals',
  closed: 'house_closed',
};


const b64d = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
async function sealKeys(token) {
  const enc = new TextEncoder();
  const a = await crypto.subtle.digest('SHA-256', enc.encode('enc|' + SEAL_SECRET + '|' + token));
  const m = await crypto.subtle.digest('SHA-256', enc.encode('mac|' + SEAL_SECRET + '|' + token));
  return {
    aes: await crypto.subtle.importKey('raw', a, 'AES-GCM', false, ['decrypt']),
    mac: await crypto.subtle.importKey('raw', m, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']),
  };
}
async function openSeal(token, b) {
  if (typeof b.iv !== 'string' || typeof b.ct !== 'string' || typeof b.mac !== 'string' || b.ct.length > 4000) return null;
  try {
    const k = await sealKeys(token);
    const ok = await crypto.subtle.verify('HMAC', k.mac, b64d(b.mac), new TextEncoder().encode(b.iv + '.' + b.ct));
    if (!ok) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(b.iv) }, k.aes, b64d(b.ct));
    const o = JSON.parse(new TextDecoder().decode(pt));
    return o && o.t === token && typeof o.n === 'string' && o.n.length >= 8 ? o : null;
  } catch (_) { return null; }
}

function cors(req) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGINS.includes(o) || LOCAL_RE.test(o);
  return {
    'Access-Control-Allow-Origin': ok ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } });
}
const err = (req, code, msg, status = 400) => json(req, { ok: false, error: code, message: msg }, status);

const p2 = (n) => String(n).padStart(2, '0');
export function periodKeys(ms) {
  const d = new Date(ms + JST);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const s = new Date(Date.UTC(y, m, day - d.getUTCDay()));
  return {
    day: `${y}-${p2(m + 1)}-${p2(day)}`,
    week: `${s.getUTCFullYear()}-${p2(s.getUTCMonth() + 1)}-${p2(s.getUTCDate())}`,
    month: `${y}-${p2(m + 1)}`,
    year: `${y}`,
  };
}

function isTestOverride(url, env) {
  return env && env.TEST_TIME_OVERRIDE === '1' && /(?:^|\.)house-ranking-test\./.test(url.hostname);
}
export function resolveNow(req, env, url, fallback = Date.now()) {
  if (!isTestOverride(url, env)) return fallback;
  const raw = url.searchParams.get('now') || req.headers.get('X-Test-Now');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1e15 ? n : fallback;
}
export function resolveAlltimeStart(req, env, url) {
  if (isTestOverride(url, env)) {
    const raw = url.searchParams.get('alltimeStart') || env.ALLTIME_START;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 1e15) return n;
  }
  return ALLTIME_START_MS;
}
export function parseYears(y) {
  return String(y == null ? '' : y).split(',').map((s) => s.trim()).filter((s) => /^\d{4}$/.test(s)).sort();
}

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); }

function cleanNick(s) {
  let n = String(s == null ? '' : s).normalize('NFKC').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  n = [...n].slice(0, 12).join('');
  return n || '名無し';
}

async function auth(env, id, secret) {
  if (typeof id !== 'string' || typeof secret !== 'string' || id.length > 64 || secret.length > 128) return null;
  const row = await env.DB.prepare(`SELECT id, nickname, secret_hash FROM ${T.players} WHERE id = ?`).bind(id).first();
  if (!row || row.secret_hash !== await sha256(secret)) return null;
  return row;
}

async function claimNick(env, base, writer) {
  for (let i = 1; i <= 500; i++) {
    let nick = base;
    if (i > 1) { const suf = String(i); nick = [...base].slice(0, 12 - suf.length).join('') + suf; }
    try { await writer(nick); return { nickname: nick, adjusted: i > 1 }; }
    catch (e) { if (!/UNIQUE/i.test(String(e && e.message))) throw e; }
  }
  throw new Error('nickname exhausted');
}

const BOARD_SQL = (col) =>
  `SELECT s.player_id, MIN(s.ms) AS score, COUNT(*) AS n, MIN(s.created_at) AS at, p.nickname
   FROM ${T.scores} s JOIN ${T.players} p ON p.id = s.player_id
   WHERE s.${col} = ?1 GROUP BY s.player_id ORDER BY score ASC, at ASC, s.player_id ASC`;

const ALLTIME_SQL =
  `SELECT b.player_id, b.ms AS score, 1 AS n, b.at, p.nickname,
          (SELECT GROUP_CONCAT(DISTINCT year) FROM ${T.scores} s WHERE s.player_id = b.player_id AND s.created_at >= ?1) AS years
   FROM ${T.bests} b JOIN ${T.players} p ON p.id = b.player_id
   WHERE b.at >= ?1
   ORDER BY b.ms ASC, b.at ASC, b.player_id ASC`;

async function closePeriods(env, now = Date.now()) {
  const cur = periodKeys(now);
  let closed = 0;
  for (const t of TYPES) {
    const { results } = await env.DB.prepare(
      `SELECT DISTINCT ${t} AS k FROM ${T.scores} WHERE ${t} < ?1 AND ${t} NOT IN (SELECT period_key FROM ${T.closed} WHERE period_type = ?2) LIMIT 20`
    ).bind(cur[t], t).all();
    for (const { k } of results) {
      const stmts = [];
      const top = await env.DB.prepare(BOARD_SQL(t) + ' LIMIT 3').bind(k).all();
      top.results.forEach((r, i) => stmts.push(
        env.DB.prepare(`INSERT OR IGNORE INTO ${T.medals} (period_type, period_key, board, rank, player_id, ms, awarded_at) VALUES (?,?,?,?,?,?,?)`)
          .bind(t, k, 'best', i + 1, r.player_id, r.score, now)
      ));
      stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${T.closed} (period_type, period_key, closed_at) VALUES (?,?,?)`).bind(t, k, now));
      await env.DB.batch(stmts);
      closed++;
    }
  }
  return closed;
}

async function medalsFor(env, ids) {
  const out = {};
  for (const id of ids) out[id] = { list: [], counts: {} };
  if (!ids.length) return out;
  const q = `SELECT player_id, period_type, period_key, board, rank, ms FROM ${T.medals} WHERE player_id IN (${ids.map(() => '?').join(',')}) ORDER BY awarded_at DESC LIMIT 600`;
  const { results } = await env.DB.prepare(q).bind(...ids).all();
  for (const r of results) {
    const o = out[r.player_id]; if (!o) continue;
    o.list.push({ type: r.period_type, key: r.period_key, board: r.board, rank: r.rank, ms: r.ms });
    const ck = `${r.period_type}_${r.rank}`; o.counts[ck] = (o.counts[ck] || 0) + 1;
  }
  return out;
}

async function body(req) { try { return await req.json(); } catch (_) { return {}; } }

async function currentStreak(env, playerId) {
  const { results } = await env.DB.prepare(
    `SELECT won, ms, issued_at FROM ${T.wins} WHERE player_id = ? ORDER BY issued_at DESC, id DESC LIMIT 50`
  ).bind(playerId).all();
  const streak = [];
  for (const r of results) {
    if (!r.won) break;
    streak.push(r);
  }
  return streak; // newest first
}

export default {
  async fetch(req, env, ctx) {
    if (env && env.SEAL_SECRET) SEAL_SECRET = env.SEAL_SECRET;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url), path = url.pathname.replace(/\/+$/, '') || '/';
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    const now = resolveNow(req, env, url);
    try {
      if (path === '/' || path === '/health') return json(req, { ok: true, service: 'house-ranking', now });

      if (path === '/register' && req.method === 'POST') {
        const b = await body(req);
        const c = await env.DB.prepare(`SELECT COUNT(*) c FROM ${T.players} WHERE ip = ? AND created_at > ?`).bind(ip, now - 3600e3).first();
        if (c.c >= REGISTER_PER_HOUR_IP) return err(req, 'rate', '登録が多すぎます。しばらく待ってください', 429);
        const id = 'h' + randHex(12), secret = randHex(24), h = await sha256(secret);
        const r = await claimNick(env, cleanNick(b.nickname), (n) =>
          env.DB.prepare(`INSERT INTO ${T.players} (id, secret_hash, nickname, ip, created_at) VALUES (?,?,?,?,?)`).bind(id, h, n, ip, now).run()
        );
        return json(req, { ok: true, id, secret, ...r });
      }

      if (path === '/nickname' && req.method === 'POST') {
        const b = await body(req), p = await auth(env, b.id, b.secret);
        if (!p) return err(req, 'auth', '認証に失敗しました', 401);
        const want = cleanNick(b.nickname);
        if (want === p.nickname) return json(req, { ok: true, nickname: want, adjusted: false });
        return json(req, { ok: true, ...await claimNick(env, want, (n) => env.DB.prepare(`UPDATE ${T.players} SET nickname = ? WHERE id = ?`).bind(n, p.id).run()) });
      }

      if (path === '/me' && req.method === 'POST') {
        const b = await body(req), p = await auth(env, b.id, b.secret);
        if (!p) return err(req, 'auth', '認証に失敗しました', 401);
        return json(req, { ok: true, id: p.id, nickname: p.nickname });
      }

      if (path === '/match/start' && req.method === 'POST') {
        const b = await body(req), p = await auth(env, b.id, b.secret);
        if (!p) return err(req, 'auth', '認証に失敗しました', 401);
        const h = now - 3600e3;
        const [x, y] = await env.DB.batch([
          env.DB.prepare(`SELECT COUNT(*) c FROM ${T.tokens} WHERE player_id = ? AND issued_at > ?`).bind(p.id, h),
          env.DB.prepare(`SELECT COUNT(*) c FROM ${T.tokens} WHERE ip = ? AND issued_at > ?`).bind(ip, h),
        ]);
        if (x.results[0].c >= TOKENS_PER_HOUR_PLAYER || y.results[0].c >= TOKENS_PER_HOUR_IP) {
          return err(req, 'rate', '対局回数が多すぎます（1時間あたりの上限）', 429);
        }
        const token = randHex(16);
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO ${T.tokens} (token, player_id, ip, issued_at) VALUES (?,?,?,?)`).bind(token, p.id, ip, now),
          env.DB.prepare(`DELETE FROM ${T.tokens} WHERE issued_at < ?`).bind(now - 2 * 86400e3),
        ]);
        return json(req, { ok: true, token });
      }

      if (path === '/match/submit' && req.method === 'POST') {
        const b = await body(req), p = await auth(env, b.id, b.secret);
        if (!p) return err(req, 'auth', '認証に失敗しました', 401);
        if (typeof b.token !== 'string' || b.token.length > 64) return err(req, 'token', 'トークンがありません');
        const o = await openSeal(b.token, b);
        if (!o) return err(req, 'seal', '記録の署名が不正です（改ざん）', 422);
        const ms = Number(o.s);
        const won = o.w === true || o.w === 1 || o.w === '1' ? 1 : 0;
        if (!Number.isSafeInteger(ms) || ms < 0 || ms > 24 * 3600e3) return err(req, 'value', '記録が不正です');
        const late = !!b.late;
        const t = await env.DB.prepare(
          `UPDATE ${T.tokens} SET used_at = ?1 WHERE token = ?2 AND player_id = ?3 AND used_at IS NULL RETURNING issued_at`
        ).bind(now, b.token, p.id).first();
        if (!t) return err(req, 'token', 'トークンが無効か使用済みです', 409);
        const wall = now - t.issued_at;
        const maxAge = (late ? LATE_MAX_AGE_SEC : MAX_TOKEN_AGE_SEC) * 1000;
        if (wall < MIN_WALL_MS) return err(req, 'fast', '対戦時間が短すぎます', 422);
        if (wall > maxAge) return err(req, 'expired', 'トークンの期限切れです', 422);
        if (won && ms < MIN_MS) return err(req, 'cap', '記録が速すぎます', 422);
        if (won && ms > wall + 2000) return err(req, 'time', '対局時間と記録が一致しません', 422);

        await env.DB.prepare(
          `INSERT INTO ${T.wins} (player_id, token, won, ms, issued_at, created_at) VALUES (?,?,?,?,?,?)`
        ).bind(p.id, b.token, won, won ? ms : 0, t.issued_at, now).run();

        const streakRows = await currentStreak(env, p.id);
        const streak = streakRows.length;
        let windowMs = null, updated = false, best = null, rank = null, periodRank = null;
        if (won && streak >= 3) {
          windowMs = streakRows[0].ms + streakRows[1].ms + streakRows[2].ms;
          const pk = periodKeys(now);
          await env.DB.prepare(
            `INSERT INTO ${T.scores} (player_id, ms, created_at, day, week, month, year) VALUES (?,?,?,?,?,?,?)`
          ).bind(p.id, windowMs, now, pk.day, pk.week, pk.month, pk.year).run();
          const prev = await env.DB.prepare(`SELECT ms, at FROM ${T.bests} WHERE player_id = ?`).bind(p.id).first();
          updated = !prev || windowMs < prev.ms;
          if (updated) {
            await env.DB.prepare(
              `INSERT INTO ${T.bests} (player_id, ms, at) VALUES (?,?,?) ON CONFLICT(player_id) DO UPDATE SET ms = excluded.ms, at = excluded.at`
            ).bind(p.id, windowMs, now).run();
          }
          best = updated ? windowMs : prev.ms;
          const start = resolveAlltimeStart(req, env, url);
          const all = await env.DB.prepare(
            `SELECT COUNT(*) c FROM ${T.bests} WHERE at >= ? AND (ms < ? OR (ms = ? AND at < (SELECT at FROM ${T.bests} WHERE player_id = ?)))`
          ).bind(start, best, best, p.id).first();
          rank = all.c + 1;
          const weekKey = pk.week;
          const wr2 = await env.DB.prepare(
            `SELECT COUNT(*) c FROM (
               SELECT player_id, MIN(ms) m, MIN(created_at) at FROM ${T.scores} WHERE week = ? GROUP BY player_id
             ) x JOIN (SELECT MIN(ms) m, MIN(created_at) at FROM ${T.scores} WHERE week = ? AND player_id = ?) me
             ON x.m < me.m OR (x.m = me.m AND x.at < me.at) OR (x.m = me.m AND x.at = me.at AND x.player_id < ?)`
          ).bind(weekKey, weekKey, p.id, p.id).first();
          periodRank = wr2.c + 1;
        } else if (p) {
          const prev = await env.DB.prepare(`SELECT ms FROM ${T.bests} WHERE player_id = ?`).bind(p.id).first();
          best = prev ? prev.ms : null;
        }
        return json(req, { ok: true, won: !!won, ms: won ? ms : 0, streak, windowMs, updated, best, rank, periodRank, period: 'week' });
      }

      if (path === '/ranking' && req.method === 'GET') {
        ctx.waitUntil(closePeriods(env, now).catch(() => {}));
        const me = url.searchParams.get('id') || '';
        const period = url.searchParams.get('period') || 'week';
        if (period === 'alltime') {
          const start = resolveAlltimeStart(req, env, url);
          const open = now >= start;
          const out = { ok: true, period: 'alltime', board: 'best', key: 'alltime', current: true, open, startsAt: start, total: 0, top: [], me: null };
          if (!open) return json(req, out);
          const { results } = await env.DB.prepare(ALLTIME_SQL + ' LIMIT 5000').bind(start).all();
          const top = results.slice(0, TOP).map((r, i) => ({ rank: i + 1, id: r.player_id, nickname: r.nickname, ms: r.score, n: r.n, at: r.at, years: parseYears(r.years) }));
          let mine = null;
          if (me) { const i = results.findIndex((r) => r.player_id === me); if (i >= 0) mine = { rank: i + 1, ms: results[i].score, n: results[i].n, at: results[i].at, years: parseYears(results[i].years) }; }
          out.total = results.length; out.top = top; out.me = mine;
          return json(req, out);
        }
        const type = TYPES.includes(period) ? period : 'week';
        const cur = periodKeys(now)[type];
        const key = /^[0-9-]{4,10}$/.test(url.searchParams.get('key') || '') ? url.searchParams.get('key') : cur;
        const { results } = await env.DB.prepare(BOARD_SQL(type) + ' LIMIT 5000').bind(key).all();
        const top = results.slice(0, TOP).map((r, i) => ({ rank: i + 1, id: r.player_id, nickname: r.nickname, ms: r.score, n: r.n, at: r.at }));
        let mine = null;
        if (me) { const i = results.findIndex((r) => r.player_id === me); if (i >= 0) mine = { rank: i + 1, ms: results[i].score, n: results[i].n, at: results[i].at }; }
        return json(req, { ok: true, period: type, board: 'best', key, current: key === cur, total: results.length, top, me: mine });
      }

      if (path === '/medals' && req.method === 'GET') {
        const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => /^h[0-9a-f]{24}$/.test(s)).slice(0, 4);
        ctx.waitUntil(closePeriods(env, now).catch(() => {}));
        const m = await medalsFor(env, ids);
        if (ids.length) {
          const { results } = await env.DB.prepare(`SELECT id, nickname FROM ${T.players} WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
          for (const r of results) m[r.id].nickname = r.nickname;
        }
        return json(req, { ok: true, medals: m });
      }

      return err(req, 'notfound', 'not found', 404);
    } catch (e) {
      return err(req, 'server', 'サーバーエラー: ' + String(e && e.message || e).slice(0, 120), 500);
    }
  },
  async scheduled(ev, env, ctx) { if (env && env.SEAL_SECRET) SEAL_SECRET = env.SEAL_SECRET; ctx.waitUntil(closePeriods(env)); },
};
