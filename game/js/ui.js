/**
 * トリックハウスバトル — Mobile-first UI screens & overlays
 */

export function $(id) {
  return document.getElementById(id);
}

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('active', el.id === id);
  });
  if (id === 'screen-title' && window.__nkCheckUpdate) setTimeout(() => { try { window.__nkCheckUpdate(); } catch (_) {} }, 1500);
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
    // Allow text fields; allow title/tutorial scroll on short phones
    if (e.target.closest('input, textarea')) return;
    if (e.target.closest('#screen-title')) return;
    if (e.target.closest('#screen-shop')) return;
    if (e.target.closest('#screen-tutorial .allow-scroll, .allow-scroll')) return;
    e.preventDefault();
  };
  const blockGesture = (e) => e.preventDefault();
  root.addEventListener('touchmove', blockMove, { passive: false });
  document.addEventListener('touchmove', blockMove, { passive: false });
  document.addEventListener('gesturestart', blockGesture, { passive: false });
  document.addEventListener('gesturechange', blockGesture, { passive: false });
  // Kill wheel / trackpad scroll on desktop embeds (except tutorial card)
  document.addEventListener('wheel', (e) => {
    if (e.target.closest('#screen-shop .allow-scroll, #screen-tutorial .allow-scroll, .allow-scroll, input, textarea')) return;
    e.preventDefault();
  }, { passive: false });
}

export function flashOverlay(el, text, ms = 900) {
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * Visual "you can scroll" cue (no text). Shows only when el actually overflows:
 * bottom fade + bouncing chevron until scrolled to the end, top fade once scrolled down.
 * Wraps el in .scroll-hint-wrap. Idempotent; returns an update() function.
 */
export function attachScrollHint(el) {
  if (!el) return () => {};
  if (el._scrollHintUpdate) { el._scrollHintUpdate(); return el._scrollHintUpdate; }
  const wrap = document.createElement('div');
  wrap.className = 'scroll-hint-wrap';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  el.classList.add('scroll-hint-el');
  const top = document.createElement('div'); top.className = 'scroll-hint-fade top';
  const bot = document.createElement('div'); bot.className = 'scroll-hint-fade bottom';
  const chev = document.createElement('div'); chev.className = 'scroll-hint-chevron'; chev.setAttribute('aria-hidden', 'true');
  chev.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  [top, bot].forEach((n) => n.setAttribute('aria-hidden', 'true'));
  wrap.append(top, bot, chev);
  chev.addEventListener('click', () => el.scrollBy({ top: el.clientHeight * 0.7, behavior: 'smooth' }));
  const update = () => {
    const over = el.scrollHeight - el.clientHeight > 2;
    const atTop = el.scrollTop <= 2;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    wrap.classList.toggle('is-overflow', over);
    wrap.classList.toggle('show-top', over && !atTop);
    wrap.classList.toggle('show-bottom', over && !atEnd);
  };
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (window.ResizeObserver) { const ro = new ResizeObserver(update); ro.observe(el); ro.observe(wrap); }
  if (window.MutationObserver) new MutationObserver(() => requestAnimationFrame(update)).observe(el, { childList: true, subtree: true, characterData: true });
  el._scrollHintUpdate = update;
  requestAnimationFrame(update);
  return update;
}
