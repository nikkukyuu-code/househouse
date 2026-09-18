/**
 * ハウスと罠 — Mobile-first UI screens & overlays
 */

export function $(id) {
  return document.getElementById(id);
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('active', el.id === id);
  });
}

export function setStatus(el, text, kind = '') {
  if (!el) return;
  el.textContent = text;
  el.className = 'status-msg' + (kind ? ' ' + kind : '');
}

/** hp may be fractional (e.g. 8.5) for half-heart display */
export function heartsHtml(hp, max) {
  const n = Number(hp);
  let s = '';
  for (let i = 0; i < max; i++) {
    const fill = n - i;
    if (fill >= 0.999) {
      s += '<span class="heart full" aria-hidden="true">♥</span>';
    } else if (fill >= 0.4) {
      s += '<span class="heart half" aria-hidden="true"><span class="heart-half-fill">♥</span>♡</span>';
    } else {
      s += '<span class="heart empty" aria-hidden="true">♡</span>';
    }
  }
  return s;
}

/** Bind press-and-hold for D-pad / buttons without 300ms delay */
export function bindHold(el, onDown, onUp) {
  if (!el) return;
  const down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('pressed');
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('pressed');
    onUp();
  };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

export function bindTap(el, fn) {
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    fn(e);
  });
}

/** Prevent page scroll/zoom on game root */
export function lockTouch(root) {
  if (!root) return;
  const blockMove = (e) => {
    // Allow text fields; allow title menu scroll on short phones
    if (e.target.closest('input, textarea')) return;
    if (e.target.closest('#screen-title')) return;
    e.preventDefault();
  };
  const blockGesture = (e) => e.preventDefault();
  root.addEventListener('touchmove', blockMove, { passive: false });
  document.addEventListener('touchmove', blockMove, { passive: false });
  document.addEventListener('gesturestart', blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  // Kill wheel / trackpad scroll on desktop embeds
  document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
}

export function flashOverlay(el, text, ms = 900) {
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}
