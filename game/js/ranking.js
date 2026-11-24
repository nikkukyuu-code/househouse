/**
 * トリックハウスバトル — online ranking client (COM 3-win search-time, lower is better).
 * NEW localStorage keys only (never rename existing progress keys). Each has a -bak copy.
 */
import { sealScore } from './seal.js?v=20261125044051';
import { $, showScreen, attachScrollHint } from './ui.js?v=20261125044051';

const PROD_API = 'https://house-ranking.nikkukyuu.workers.dev';
const TEST_API = 'https://house-ranking-test.nikkukyuu.workers.dev';
export const RANK_API = (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))
  ? TEST_API
  : PROD_API;

const K_ID = 'househouse-rank-online-id';
const K_SECRET = 'househouse-rank-online-secret';
const K_NICK = 'househouse-rank-nickname';
const K_STREAK = 'househouse-rank-streak-v1';
const K_PENDING = 'househouse-rank-pending-v1';
export const FAIL_MSG = '登録に失敗しました。今は混み合っているのですみませんが24時間後ランキングを押して登録し直してください。';
export const DEFAULT_NICK = '名無し';
export const DUP_MSG = '重複していますので数字を付加しました';
const PENDING_MAX = 8;
const JST = 9 * 3600 * 1000;

function lsGet(k) {
  try { return localStorage.getItem(k) || localStorage.getItem(k + '-bak') || ''; } catch (_) { return ''; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, v); localStorage.setItem(k + '-bak', v); } catch (_) {}
}

export function rankIdentity() {
  return { id: lsGet(K_ID), secret: lsGet(K_SECRET), nickname: lsGet(K_NICK) || DEFAULT_NICK };
}

async function api(path, { method = 'GET', body, timeout = 6000 } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), timeout);
  try {
    const r = await fetch(RANK_API + path, {
      method: body ? 'POST' : method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined,
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, status: r.status, message: j.message || '通信エラー', error: j.error };
    return j;
  } catch (_) {
    return { ok: false, offline: true, message: 'ランキングサーバーに接続できません' };
  } finally { clearTimeout(t); }
}

let registering = null;
export async function ensurePlayer() {
  const me = rankIdentity();
  if (me.id && me.secret) return { ok: true, ...me, adjusted: false };
  if (registering) return registering;
  registering = (async () => {
    const r = await api('/register', { method: 'POST', body: { nickname: me.nickname } });
    if (!r.ok) return { ok: false, message: r.message || FAIL_MSG };
    lsSet(K_ID, r.id); lsSet(K_SECRET, r.secret); lsSet(K_NICK, r.nickname);
    return { ok: true, id: r.id, secret: r.secret, nickname: r.nickname, adjusted: !!r.adjusted };
  })();
  try { return await registering; } finally { registering = null; }
}

export async function setNickname(name) {
  const me = rankIdentity();
  if (!me.id || !me.secret) {
    lsSet(K_NICK, String(name || '').slice(0, 12));
    return ensurePlayer();
  }
  const r = await api('/nickname', { method: 'POST', body: { id: me.id, secret: me.secret, nickname: name } });
  if (r.ok) lsSet(K_NICK, r.nickname);
  return r;
}

/* ---------- local streak (COM only) ---------- */
function emptyStreak() {
  return { streak: 0, times: [], bestMs: null, bestStreak: 0, lastWindowMs: null };
}
function cleanStreak(o) {
  if (!o || typeof o !== 'object') return emptyStreak();
  const times = Array.isArray(o.times) ? o.times.map((n) => Math.max(0, Math.floor(Number(n) || 0))).filter((n) => n > 0).slice(-50) : [];
  const streak = Math.max(0, Math.floor(Number(o.streak) || 0));
  const bestStreak = Math.max(streak, Math.floor(Number(o.bestStreak) || 0));
  const bestMs = o.bestMs == null ? null : Math.max(0, Math.floor(Number(o.bestMs)));
  const lastWindowMs = o.lastWindowMs == null ? null : Math.max(0, Math.floor(Number(o.lastWindowMs)));
  return { streak, times, bestMs, bestStreak, lastWindowMs };
}
export function loadStreak() {
  try {
    const a = JSON.parse(lsGet(K_STREAK) || 'null');
    return cleanStreak(a);
  } catch (_) { return emptyStreak(); }
}
function saveStreak(s) {
  const merged = cleanStreak(s);
  // never decrease bestStreak / never worsen bestMs
  const prev = loadStreak();
  merged.bestStreak = Math.max(merged.bestStreak, prev.bestStreak || 0);
  if (prev.bestMs != null && (merged.bestMs == null || merged.bestMs > prev.bestMs)) merged.bestMs = prev.bestMs;
  lsSet(K_STREAK, JSON.stringify(merged));
  return merged;
}

export function formatRankTime(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(n / 60000);
  const s = Math.floor((n % 60000) / 1000);
  const frac = String(n % 1000).padStart(3, '0');
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${frac}`;
  return `${s}.${frac}秒`;
}

/** Apply a COM result locally. Returns {streak, windowMs, isPb, almost, bestMs, bestStreak, searchMs}. */
export function applyComResult(won, searchMs) {
  const s = loadStreak();
  const ms = Math.max(0, Math.round(Number(searchMs) || 0));
  if (!won) {
    s.streak = 0;
    s.times = [];
    s.lastWindowMs = null;
    saveStreak(s);
    return { streak: 0, windowMs: null, isPb: false, almost: false, bestMs: s.bestMs, bestStreak: s.bestStreak, searchMs: ms };
  }
  s.times.push(ms);
  s.streak = (s.streak || 0) + 1;
  if (s.streak > (s.bestStreak || 0)) s.bestStreak = s.streak;
  let windowMs = null, isPb = false;
  if (s.streak >= 3 && s.times.length >= 3) {
    const last3 = s.times.slice(-3);
    windowMs = last3[0] + last3[1] + last3[2];
    s.lastWindowMs = windowMs;
    if (s.bestMs == null || windowMs < s.bestMs) { s.bestMs = windowMs; isPb = true; }
  }
  saveStreak(s);
  return { streak: s.streak, windowMs, isPb, almost: s.streak === 2, bestMs: s.bestMs, bestStreak: s.bestStreak, searchMs: ms };
}

/* ---------- match token + submit ---------- */
let _match = null;

export async function beginComRankMatch() {
  const en = await ensurePlayer();
  if (!en.ok) return { ok: false, message: en.message };
  let me = rankIdentity();
  let r = await api('/match/start', { method: 'POST', body: { id: me.id, secret: me.secret } });
  if (!r.ok && r.status === 401) {
    const re = await api('/register', { method: 'POST', body: { nickname: me.nickname } });
    if (re.ok) {
      lsSet(K_ID, re.id); lsSet(K_SECRET, re.secret); lsSet(K_NICK, re.nickname);
      me = rankIdentity();
      r = await api('/match/start', { method: 'POST', body: { id: me.id, secret: me.secret } });
    }
  }
  if (!r.ok || !r.token) return r;
  _match = { token: r.token, startedAt: Date.now() };
  return { ok: true, token: r.token };
}

export function cancelComRankMatch() { _match = null; }

function pendingList() {
  try { return JSON.parse(lsGet(K_PENDING) || '[]') || []; } catch (_) { return []; }
}
function pendingSave(list) { lsSet(K_PENDING, JSON.stringify(list.slice(-PENDING_MAX))); }
function pendingAdd(item) {
  const l = pendingList().filter((x) => x.token !== item.token);
  l.push(item); pendingSave(l);
}
function pendingRemove(token) { pendingSave(pendingList().filter((x) => x.token !== token)); }
function isTransient(r) { return !!(r.offline || !r.status || r.status === 408 || r.status === 429 || r.status >= 500); }

export async function submitComResult(won, searchMs) {
  const token = _match && _match.token;
  _match = null;
  if (!token) return { ok: false, skipped: true };
  const me = rankIdentity();
  if (!me.id || !me.secret) return { ok: false, skipped: true };
  const payload = { s: Math.max(0, Math.round(Number(searchMs) || 0)), w: won ? 1 : 0 };
  let sealed;
  try { sealed = await sealScore(token, payload); }
  catch (e) { return { ok: false, message: '署名に失敗しました' }; }
  const r = await api('/match/submit', { method: 'POST', body: { id: me.id, secret: me.secret, token, ...sealed }, timeout: 10000 });
  if (r.ok) { pendingRemove(token); return r; }
  if (isTransient(r)) {
    pendingAdd({ token, sealed, won: payload.w, ms: payload.s, at: Date.now() });
    return { ok: false, pending: true, message: r.message };
  }
  return r;
}

export async function retryPending() {
  const list = pendingList();
  if (!list.length) return;
  const me = rankIdentity();
  if (!me.id || !me.secret) return;
  for (const it of list) {
    const r = await api('/match/submit', { method: 'POST', body: { id: me.id, secret: me.secret, token: it.token, ...it.sealed, late: true }, timeout: 10000 });
    if (r.ok || (r.error === 'token' || r.error === 'seal' || r.error === 'expired')) pendingRemove(it.token);
  }
}

export function fetchRanking(period, key) {
  const me = rankIdentity();
  const q = new URLSearchParams({ period: period || 'week' });
  if (key) q.set('key', key);
  if (me.id) q.set('id', me.id);
  return api('/ranking?' + q.toString());
}
export function fetchMedals(ids) {
  const list = (ids || []).filter(Boolean).slice(0, 4);
  if (!list.length) return Promise.resolve({ ok: true, medals: {} });
  return api('/medals?ids=' + encodeURIComponent(list.join(',')));
}

/* ---------- JST period helpers (match the Worker) ---------- */
export function periodKeys(ms = Date.now()) {
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
const p2 = (n) => String(n).padStart(2, '0');
export function shiftKey(type, key, n) {
  if (type === 'day') {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
  }
  if (type === 'week') {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n * 7));
    return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
  }
  if (type === 'month') {
    const [y, m] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}`;
  }
  if (type === 'year') return String(Number(key) + n);
  return key;
}
export const PERIOD_JA = { day: '日間', week: '週間', month: '月間', year: '年間', alltime: '歴代' };
export function periodLabel(type, key) {
  if (type === 'alltime') return '歴代';
  if (type === 'year') return `${key}年`;
  if (type === 'month') { const [y, m] = key.split('-'); return `${y}年${Number(m)}月`; }
  if (type === 'week') { const [y, m, d] = key.split('-').map(Number); const end = new Date(Date.UTC(y, m - 1, d + 6)); return `${y}/${m}/${d}〜${end.getUTCMonth() + 1}/${end.getUTCDate()}`; }
  if (type === 'day') { const [y, m, d] = key.split('-'); return `${y}年${Number(m)}月${Number(d)}日`; }
  return key;
}

/* ---------- medals (period 1–3, house-themed) ---------- */
const PERIOD_COL = { day: '#4aa3ff', week: '#ff5a5a', month: '#c56bff', year: '#e8b84a' };
const METAL = { 1: { fill: '#f4d057', stroke: '#8a6a10', name: '金' }, 2: { fill: '#d0d7e2', stroke: '#5c6673', name: '銀' }, 3: { fill: '#d08a4a', stroke: '#6a3c14', name: '銅' } };
function medalCanvas(type, rank, cssSize) {
  const S = cssSize || 36;
  const cv = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const cx = S / 2, cy = S / 2, R = S * 0.42;
  const M = METAL[rank] || METAL[3];
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
  const grd = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  grd.addColorStop(0, '#fff8d0'); grd.addColorStop(0.35, M.fill); grd.addColorStop(1, M.stroke);
  g.fillStyle = grd; g.fill();
  g.strokeStyle = M.stroke; g.lineWidth = Math.max(1, S * 0.04); g.stroke();
  g.fillStyle = '#3a2208'; g.font = `900 ${Math.round(S * 0.38)}px sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(rank), cx, cy - S * 0.04);
  const lb = type === 'day' ? '日' : type === 'week' ? '週' : type === 'month' ? '月' : type === 'year' ? '年' : '';
  if (lb) {
    const bw = S * 0.42, bh = S * 0.22, bx = cx - bw / 2, by = cy + R * 0.42;
    g.fillStyle = PERIOD_COL[type] || '#888';
    g.strokeStyle = '#1a1008'; g.lineWidth = 1;
    g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 3) : g.rect(bx, by, bw, bh);
    g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = `800 ${Math.round(S * 0.16)}px sans-serif`;
    g.fillText(lb, cx, by + bh / 2 + 0.5);
  }
  cv.title = `${PERIOD_JA[type] || ''}${rank}位 ${M.name}メダル`;
  return cv;
}
export function medalShelf(entry, { compact = false, max = 12, scale = 1 } = {}) {
  const box = document.createElement('span');
  box.className = 'rk-medals';
  const list = (entry && entry.list) || [];
  if (!list.length) {
    const none = document.createElement('span');
    none.className = 'rk-medals-none';
    none.textContent = 'メダルなし';
    box.appendChild(none);
    return box;
  }
  list.slice(0, max).forEach((m) => box.appendChild(medalCanvas(m.type, m.rank, Math.round((compact ? 22 : 32) * scale))));
  return box;
}

/* ---------- streak / HUD / result UI ---------- */
export function refreshStreakUi() {
  const s = loadStreak();
  const title = $('title-streak');
  if (title) {
    const best = s.bestStreak ? `　最高連勝 ${s.bestStreak}` : '';
    title.textContent = `連勝 ${s.streak}${best}`;
    title.classList.toggle('almost', s.streak === 2);
    title.classList.remove('hidden');
  }
  const match = $('match-streak');
  if (match) {
    match.textContent = `連勝 ${s.streak}`;
    match.classList.toggle('almost', s.streak === 2);
    match.classList.toggle('hidden', false);
  }
}

export function paintResultRank(info, { won, com } = {}) {
  const wrap = $('result-rank');
  if (!wrap) return;
  if (!com) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  wrap.classList.remove('hidden');
  const s = loadStreak();
  wrap.innerHTML = '';
  const add = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; wrap.appendChild(d); };
  if (info && info.searchMs != null) add('rr-time', '探索時間 ' + formatRankTime(info.searchMs));
  add('rr-streak', s.bestStreak ? ('連勝 ' + s.streak + '　最高連勝 ' + s.bestStreak) : ('連勝 ' + s.streak));
  if (won && s.streak >= 3 && ((info && info.windowMs != null) || s.lastWindowMs != null)) {
    const w = (info && info.windowMs) != null ? info.windowMs : s.lastWindowMs;
    add('rr-window', '3連勝合計 ' + formatRankTime(w));
  } else if (won && s.streak === 2 && s.times.length >= 2) {
    const run = s.times.slice(-2).reduce((a, b) => a + b, 0);
    add('rr-window', '2勝合計 ' + formatRankTime(run) + '（あと1勝で記録）');
  }
  if (info && info.server) {
    const sv = info.server;
    if (sv.updated && sv.rank) add('rr-rank-hit', '自己ベスト更新！ 歴代 ' + sv.rank + '位');
    else if (sv.windowMs && sv.rank) add('rr-rank', '記録を登録しました！ 歴代 ' + sv.rank + '位');
    else if (sv.message) add('rr-msg', sv.message);
  }
  // あと1勝 banner
  const almost = $('result-almost');
  if (almost) {
    if (won && s.streak === 2) {
      almost.classList.remove('hidden');
      almost.classList.add('show');
      almost.textContent = 'あと1勝でランキング挑戦！';
    } else {
      almost.classList.add('hidden');
      almost.classList.remove('show');
    }
  }
  if (info && info.server && info.server.updated) celebrateRecord(info.server);
  else if (info && info.server && info.server.windowMs && info.server.rank) celebrateRecord(info.server);
}

export function showAlmostMatchBanner() {
  const s = loadStreak();
  const el = $('match-almost');
  if (!el) return;
  if (s.streak !== 2) { el.classList.add('hidden'); el.classList.remove('show'); return; }
  el.textContent = 'あと1勝でランキング挑戦！';
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(showAlmostMatchBanner._t);
  showAlmostMatchBanner._t = setTimeout(() => { el.classList.remove('show'); el.classList.add('hidden'); }, 2800);
}

function celebrateRecord(sv) {
  const el = $('rank-celebrate');
  if (!el) return;
  const pb = sv.updated;
  const rank = sv.rank;
  let msg = '記録を登録しました！';
  if (pb && rank) msg = `自己ベスト更新！ 歴代 ${rank}位にランクイン！`;
  else if (pb) msg = '自己ベスト更新！';
  else if (rank) msg = `記録を登録しました！ 歴代 ${rank}位`;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(celebrateRecord._t);
  celebrateRecord._t = setTimeout(() => { el.classList.remove('show'); }, 3200);
}

/* ---------- ranking screen ---------- */
let rkState = { period: 'week', key: null };

function setRkMsg(text, kind) {
  const el = $('rk-nick-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'rk-nick-msg' + (kind ? ' ' + kind : '');
}

async function renderRanking() {
  const label = $('rk-label');
  const sub = $('rk-sub');
  const list = $('rk-list');
  const meBox = $('rk-me');
  if (!list) return;
  list.innerHTML = '<li class="rk-loading">読み込み中…</li>';
  const period = rkState.period;
  const cur = periodKeys()[period];
  const key = period === 'alltime' ? null : (rkState.key || cur);
  if (label) label.textContent = periodLabel(period, key || '');
  if (sub) sub.textContent = period === 'alltime' ? '短いほど上位（3連勝の探索時間合計）' : (key === cur ? '集計中（短いほど上位）' : '終了済み');
  document.querySelectorAll('#screen-ranking .rk-period .rk-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  const r = await fetchRanking(period, key);
  if (!r.ok) {
    list.innerHTML = `<li class="rk-err">${r.message || '読み込みに失敗しました'}</li>`;
    if (meBox) meBox.textContent = '―';
    return;
  }
  if (r.period === 'alltime' && r.open === false) {
    list.innerHTML = '<li class="rk-err">歴代ランキングはまだ始まっていません</li>';
    if (meBox) meBox.textContent = '―';
    return;
  }
  const myId = rankIdentity().id;
  list.innerHTML = '';
  if (!r.top || !r.top.length) {
    const li = document.createElement('li');
    li.className = 'rk-empty';
    li.textContent = 'まだ記録がありません。COM対戦で3連勝すると載ります。';
    list.appendChild(li);
  } else {
    r.top.forEach((row) => {
      const li = document.createElement('li');
      li.className = 'rk-row' + (row.id === myId ? ' mine' : '');
      const years = row.years && row.years.length ? ` <small class="rk-years">${row.years.join(', ')}</small>` : '';
      li.innerHTML = `<span class="rk-pos">${row.rank}</span><span class="rk-name"></span><span class="rk-score">${formatRankTime(row.ms)}</span>${years}`;
      li.querySelector('.rk-name').textContent = row.nickname || DEFAULT_NICK;
      list.appendChild(li);
    });
  }
  if (meBox) {
    if (r.me) meBox.textContent = `あなたの順位　${r.me.rank}位　/　${r.total}人中　${formatRankTime(r.me.ms)}`;
    else meBox.textContent = r.total ? `まだこの期間の記録がありません（全${r.total}人）` : 'まだ記録がありません';
  }
  // medals for me
  const shelf = $('rk-my-medals');
  if (shelf && myId) {
    const med = await fetchMedals([myId]);
    shelf.innerHTML = '';
    if (med.ok && med.medals && med.medals[myId]) shelf.appendChild(medalShelf(med.medals[myId], { scale: 1.05 }));
  }
  const sc = $('rk-scroll');
  if (sc) requestAnimationFrame(() => attachScrollHint(sc));
}

export async function openRanking() {
  showScreen('screen-ranking');
  rkState.period = 'week';
  rkState.key = periodKeys().week;
  const input = $('rk-nick-input');
  if (input) input.value = rankIdentity().nickname || '';
  setRkMsg('');
  const en = await ensurePlayer();
  if (en.ok && en.adjusted) setRkMsg(DUP_MSG, 'ok');
  else if (!en.ok) setRkMsg(en.message || FAIL_MSG, 'err');
  if (input && en.ok && en.nickname) input.value = en.nickname;
  retryPending();
  await renderRanking();
}

export function bindRankingUi() {
  document.querySelectorAll('#screen-ranking .rk-period .rk-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      rkState.period = btn.dataset.period;
      rkState.key = rkState.period === 'alltime' ? null : periodKeys()[rkState.period];
      renderRanking();
    });
  });
  const prev = $('btn-rk-prev');
  const next = $('btn-rk-next');
  if (prev) prev.addEventListener('click', () => {
    if (rkState.period === 'alltime') return;
    const cur = periodKeys()[rkState.period];
    const key = rkState.key || cur;
    rkState.key = shiftKey(rkState.period, key, -1);
    renderRanking();
  });
  if (next) next.addEventListener('click', () => {
    if (rkState.period === 'alltime') return;
    const cur = periodKeys()[rkState.period];
    const key = rkState.key || cur;
    const nxt = shiftKey(rkState.period, key, 1);
    // don't go into the future
    if (nxt > cur) return;
    rkState.key = nxt;
    renderRanking();
  });
  const save = $('btn-rk-nick-save');
  if (save) save.addEventListener('click', async () => {
    const input = $('rk-nick-input');
    const r = await setNickname(input ? input.value : '');
    if (r.ok) {
      if (input) input.value = r.nickname;
      setRkMsg(r.adjusted ? DUP_MSG : '変更しました', 'ok');
      renderRanking();
    } else setRkMsg(r.message || FAIL_MSG, 'err');
  });
  const back = () => { showScreen('screen-title'); refreshStreakUi(); };
  document.querySelectorAll('[data-back="btn-ranking-back"], #btn-ranking-back').forEach((b) => {
    b.addEventListener('click', back);
  });
  const samples = $('rk-medal-sample');
  if (samples && !samples.childElementCount) {
    ['day', 'week', 'month', 'year'].forEach((t) => {
      [1, 2, 3].forEach((r) => samples.appendChild(medalCanvas(t, r, 34)));
    });
  }
}

/** Debug hook (?debug=1 only): simulate COM wins/losses against the test API path the client already uses. */
export function installDebugHook(applySearchMs) {
  if (typeof location === 'undefined' || !/[?&]debug=1\b/.test(location.search)) return;
  window.__hhRankDebug = {
    RANK_API,
    identity: rankIdentity,
    loadStreak,
    formatRankTime,
    applyComResult,
    beginComRankMatch,
    submitComResult,
    fetchRanking,
    setNickname,
    ensurePlayer,
    /** Simulate one finished COM match (does not play the game). Uses a real token if registered. */
    async simulateMatch(won, ms) {
      const start = await beginComRankMatch();
      if (!start.ok) return { start };
      // Wait so wall clock clears MIN_WALL_MS
      await new Promise((res) => setTimeout(res, 650));
      const local = applyComResult(!!won, ms);
      const server = await submitComResult(!!won, ms);
      return { start, local, server };
    },
  };
  if (typeof applySearchMs === 'function') window.__hhRankDebug.applySearchMs = applySearchMs;
}
