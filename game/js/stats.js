/**
 * Worldwide battle counter (bc) — abacus.jasoncameron.dev, key nikkukyuu/househouse-battles.
 *  - hitBattleCounter(): +1 once per match start (COM / local: always; online: host side only).
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

/** Fire-and-forget +1 for a match start. Never throws. */
export function hitBattleCounter() {
  try {
    fetch(`${BASE}/hit/${NS_KEY}?_=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const n = parseValue(d); if (n != null) writeLast(n); })
      .catch(() => {});
  } catch (_) { /* ignore */ }
}

/** Show "bc N" in `el` (hidden until a value is known). */
export async function loadBattleCount(el) {
  if (!el) return;
  const sep = el.previousElementSibling && el.previousElementSibling.classList.contains('meta-sep')
    ? el.previousElementSibling : null;
  const show = (n) => {
    el.textContent = 'bc ' + n.toLocaleString('ja-JP');
    el.hidden = false;
    if (sep) sep.hidden = false;
  };
  const last = readLast();
  if (last > 0) show(last);
  try {
    const r = await fetch(`${BASE}/get/${NS_KEY}?_=${Date.now()}`, { cache: 'no-store' });
    let n = null;
    if (r.ok) n = parseValue(await r.json());
    else if (r.status === 404) n = 0; // key not created yet
    if (n == null) return;
    const best = Math.max(n, last);
    writeLast(best);
    show(best);
  } catch (_) { /* silent: keep last known or stay hidden */ }
}
