/**
 * Worldwide battle counter (bc) — abacus.jasoncameron.dev, key nikkukyuu/househouse-battles.
 *  - hitBattleCounter(mode): +1 once per ESTABLISHED match (startMatch: COM always; online host only, after
 *    both houses exchanged + both ready). Also +1 on <key>-pvp / -com.
 *  - loadBattleCount(el): title-screen display "bc N" with never-decrease rule
 *    (localStorage househouse_battleLast; shows max(server, last)).
 * All network failures are silent.
 */
const BASE = 'https://abacus.jasoncameron.dev';
const NS_KEY = 'nikkukyuu/househouse-battles';
export const BATTLE_LAST_KEY = 'househouse_battleLast';

function readLast() {
  try {
    const n = Number(localStorage.getItem(BATTLE_LAST_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch (_) {
    return 0;
  }
}

function writeLast(n) {
  try {
    if (Number.isFinite(n) && n > readLast()) localStorage.setItem(BATTLE_LAST_KEY, String(Math.floor(n)));
  } catch (_) { /* ignore */ }
}

function parseValue(d) {
  const n = d && (typeof d.value === 'number' ? d.value : Number(d.value));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Per-mode breakdown counters (separate abacus keys; total key above unchanged). */
export const BATTLE_MODES = [
  { id: 'pvp', label: '対人' },
  { id: 'com', label: 'COM' },
];
const modeKey = (id) => `${NS_KEY}-${id}`;
const modeLastKey = (id) => `${BATTLE_LAST_KEY}_${id}`;
function readN(k) {
  try { const n = Number(localStorage.getItem(k)); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; } catch (_) { return 0; }
}
function writeN(k, n) {
  try { if (Number.isFinite(n) && n > readN(k)) localStorage.setItem(k, String(Math.floor(n))); } catch (_) { /* ignore */ }
}
function hitKey(key, lastKey) {
  try {
    fetch(`${BASE}/hit/${key}?_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const n = parseValue(d); if (n != null) writeN(lastKey, n); })
      .catch(() => {});
  } catch (_) { /* ignore */ }
}

/**
 * +1 for an ESTABLISHED battle (call only once gameplay has really started).
 * mode: 'pvp' | 'com'. Hits the total key and the mode key. Never throws.
 */
export function hitBattleCounter(mode) {
  hitKey(NS_KEY, BATTLE_LAST_KEY);
  if (BATTLE_MODES.some((m) => m.id === mode)) hitKey(modeKey(mode), modeLastKey(mode));
}

async function getCount(key) {
  try {
    const r = await fetch(`${BASE}/get/${key}?_=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) return parseValue(await r.json());
    if (r.status === 404) return 0; // key not created yet
  } catch (_) { /* silent */ }
  return null;
}

/** Show "bc N（対人 a / COM b）" in `el` (hidden until a value is known). Never decreases. */
export async function loadBattleCount(el) {
  if (!el) return;
  const sep = el.previousElementSibling && el.previousElementSibling.classList.contains('meta-sep')
    ? el.previousElementSibling : null;
  const vals = {};
  BATTLE_MODES.forEach((m) => { const l = readN(modeLastKey(m.id)); vals[m.id] = l > 0 ? l : null; });
  let total = readLast() || null;
  const paint = () => {
    if (total == null) return;
    const parts = BATTLE_MODES.filter((m) => vals[m.id] != null)
      .map((m) => `${m.label} ${vals[m.id].toLocaleString('ja-JP')}`);
    el.textContent = 'bc ' + total.toLocaleString('ja-JP');
    if (parts.length) {
      const b = document.createElement('span');
      b.className = 'bc-breakdown';
      b.textContent = `（${parts.join(' / ')}）`;
      el.appendChild(b);
    }
    el.hidden = false;
    if (sep) sep.hidden = false;
    // footer may need 2–3 lines on narrow phones: reserve exactly its real height (never clipped)
    const foot = document.getElementById('game-meta');
    if (foot) requestAnimationFrame(() => {
      const h = Math.ceil(foot.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--meta-h', h + 'px');
    });
  };
  paint();
  const [n, ...ms] = await Promise.all([getCount(NS_KEY), ...BATTLE_MODES.map((m) => getCount(modeKey(m.id)))]);
  if (n != null) { total = Math.max(n, readLast()); writeLast(total); }
  BATTLE_MODES.forEach((m, i) => {
    if (ms[i] == null) return;
    const best = Math.max(ms[i], readN(modeLastKey(m.id)));
    writeN(modeLastKey(m.id), best);
    vals[m.id] = best;
  });
  paint();
}
