// Self-contained local streak / format tests (no Worker, no network).
function formatRankTime(ms) {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const m = Math.floor(n / 60000);
  const s = Math.floor((n % 60000) / 1000);
  const frac = String(n % 1000).padStart(3, '0');
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${frac}`;
  return `${s}.${frac}秒`;
}
function apply(state, won, searchMs) {
  const s = state;
  const ms = Math.max(0, Math.round(Number(searchMs) || 0));
  if (!won) {
    s.streak = 0; s.times = []; s.lastWindowMs = null;
    return { streak: 0, windowMs: null, isPb: false, almost: false, bestMs: s.bestMs, bestStreak: s.bestStreak };
  }
  s.times.push(ms);
  s.streak += 1;
  if (s.streak > s.bestStreak) s.bestStreak = s.streak;
  let windowMs = null, isPb = false;
  if (s.streak >= 3 && s.times.length >= 3) {
    const last3 = s.times.slice(-3);
    windowMs = last3[0] + last3[1] + last3[2];
    s.lastWindowMs = windowMs;
    if (s.bestMs == null || windowMs < s.bestMs) { s.bestMs = windowMs; isPb = true; }
  }
  return { streak: s.streak, windowMs, isPb, almost: s.streak === 2, bestMs: s.bestMs, bestStreak: s.bestStreak };
}

if (formatRankTime(83456) !== '1:23.456') throw new Error('fmt min ' + formatRankTime(83456));
if (formatRankTime(23456) !== '23.456秒') throw new Error('fmt sec ' + formatRankTime(23456));
const s = { streak: 0, times: [], bestMs: null, bestStreak: 0, lastWindowMs: null };
const a = apply(s, true, 5000);
if (a.streak !== 1 || a.windowMs != null || a.almost) throw new Error('w1');
const b = apply(s, true, 6000);
if (b.streak !== 2 || !b.almost || b.windowMs != null) throw new Error('w2');
const c = apply(s, true, 7000);
if (c.streak !== 3 || c.windowMs !== 18000 || !c.isPb) throw new Error('w3');
const d = apply(s, true, 3000);
if (d.windowMs !== 16000 || !d.isPb) throw new Error('w4');
const e = apply(s, true, 20000);
if (e.windowMs !== 30000 || e.isPb) throw new Error('w5');
const f = apply(s, false, 1000);
if (f.streak !== 0 || f.windowMs != null) throw new Error('loss');
const g = apply(s, true, 4000);
if (g.streak !== 1 || s.bestMs !== 16000 || s.bestStreak !== 5) throw new Error('restart');
console.log('local streak tests passed');
