/**
 * トリックハウスバトル — room-aware interior decor (purely cosmetic).
 * Draws per-room floor materials + vector furniture into a cached layer.
 * Never reads house data (traps/chest) so it cannot leak secrets.
 * Never changes walkability; clipped to FLOOR cells only (stairs/doors/walls untouched).
 */
const COLS = 13, ROWS = 9;
const FLOOR_T = 1;
// Room origins (cell coords). A B C (top) / D E F (bottom), each 3x3.
const ROOMS = [[1, 1], [5, 1], [9, 1], [1, 5], [5, 5], [9, 5]];

const PAL = {
  basic: {
    lux: 0, jp: false,
    wood: '#b68b5c', woodDk: '#7d5a3a', woodLt: '#d7b68a',
    fab: '#7d97b3', fab2: '#c8b48e', fab3: '#a3b98a', metal: '#a7adb3', gold: '#c9b27a',
    plank: '#c7a074', tile: '#dcd8cc', tile2: '#cbc6b8', tatami: '#c8c08c',
    carpet: '#b9a98a', rug: '#a9b8c8', rugB: '#8a9aac',
  },
  cottage: {
    lux: 1, jp: false,
    wood: '#a46a3e', woodDk: '#6e4426', woodLt: '#d29a64',
    fab: '#b84f3c', fab2: '#e6c690', fab3: '#6f9150', metal: '#9b8f80', gold: '#d8b060',
    plank: '#b9804c', tile: '#c97a52', tile2: '#b86a44', tatami: '#c9bf86',
    carpet: '#c98f63', rug: '#c25a42', rugB: '#e8c690',
  },
  mansion: {
    lux: 2, jp: false,
    wood: '#6e3020', woodDk: '#3e1810', woodLt: '#9a5236',
    fab: '#8c1f2e', fab2: '#2f5a44', fab3: '#d9c9a0', metal: '#d8b04a', gold: '#dcb24c',
    plank: '#8c5a32', tile: '#ece8de', tile2: '#2a2622', tatami: '#c9bf86',
    carpet: '#7c1c26', rug: '#8c1f2e', rugB: '#dcb24c',
  },
  villa: {
    lux: 4, jp: false,
    wood: '#5c3d2a', woodDk: '#34231a', woodLt: '#8a6448',
    fab: '#ece4d4', fab2: '#3a3e46', fab3: '#2aa3b2', metal: '#c9ccd2', gold: '#e6c56a',
    plank: '#d6bc94', tile: '#f1ede6', tile2: '#d9d2c6', tatami: '#c9bf86',
    carpet: '#e6dfd2', rug: '#efe8dc', rugB: '#e6c56a',
  },
  castle_keep: {
    lux: 3, jp: true,
    wood: '#4a3424', woodDk: '#2a1c12', woodLt: '#7a5a3c',
    fab: '#2c3e6b', fab2: '#8b2a24', fab3: '#e9e2cc', metal: '#7f8890', gold: '#cfa83e',
    plank: '#6a4c34', tile: '#8a8478', tile2: '#77716a', tatami: '#bdb46c',
    carpet: '#2c3e6b', rug: '#8b2a24', rugB: '#cfa83e',
  },
  osaka: {
    lux: 5, jp: true,
    wood: '#a01c1c', woodDk: '#1e120c', woodLt: '#d23a2a',
    fab: '#b3151b', fab2: '#1e2a5a', fab3: '#fff2c2', metal: '#f2c94c', gold: '#f4c842',
    plank: '#3a1c12', tile: '#8a8478', tile2: '#77716a', tatami: '#ab9446',
    carpet: '#a3121a', rug: '#b3151b', rugB: '#f4c842',
  },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function rr(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function box(ctx, x, y, w, h, r, fill, stroke, lw = 1) {
  rr(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function circ(ctx, x, y, r, fill, stroke, lw = 1) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
/** Solid piece: body + darker front lip (top-down 3/4 depth) */
function solid(ctx, x, y, w, h, r, top, u) {
  const lip = Math.max(1.5, u * 0.06);
  box(ctx, x, y + lip, w, h, r, shade(top, -45));
  box(ctx, x, y, w, h - lip * 0.2, r, top);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  rr(ctx, x + w * 0.06, y + h * 0.06, w * 0.88, Math.max(1, h * 0.12), r * 0.5); ctx.fill();
}

/* ---------------- floor materials ---------------- */
function drawFloorMat(g, kind, x, y, w, h, seed) {
  const { ctx, u, P } = g;
  const R = rng(seed);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (kind === 'plank' || kind === 'plankDark' || kind === 'plankLight') {
    const base = kind === 'plankDark' ? P.woodDk : kind === 'plankLight' ? shade(P.plank, 18) : P.plank;
    const pw = u * (P.lux >= 4 ? 0.34 : 0.26);
    for (let yy = y; yy < y + h; yy += pw) {
      ctx.fillStyle = shade(base.startsWith('#') ? base : P.plank, Math.round((R() - 0.5) * 18));
      ctx.fillRect(x, yy, w, pw);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x, yy + pw - 1, w, 1);
      let jx = x + R() * u * 1.2;
      while (jx < x + w) { ctx.fillRect(jx, yy, 1, pw); jx += u * (1.1 + R() * 0.8); }
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, yy + 1, w, pw * 0.3);
    }
  } else if (kind === 'parquet') {
    const s = u * 0.25;
    for (let yy = y, r = 0; yy < y + h; yy += s, r++) {
      for (let xx = x, c = 0; xx < x + w; xx += s, c++) {
        const odd = (r + c) % 2;
        ctx.fillStyle = shade(P.plank, odd ? -14 : 6);
        ctx.fillRect(xx, yy, s, s);
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let k = 1; k < 3; k++) {
          if (odd) { ctx.moveTo(xx + (s * k) / 3, yy); ctx.lineTo(xx + (s * k) / 3, yy + s); }
          else { ctx.moveTo(xx, yy + (s * k) / 3); ctx.lineTo(xx + s, yy + (s * k) / 3); }
        }
        ctx.stroke();
      }
    }
  } else if (kind === 'tile' || kind === 'checker' || kind === 'terracotta') {
    const s = u * (kind === 'checker' ? 0.3 : kind === 'terracotta' ? 0.36 : 0.25);
    for (let yy = y, r = 0; yy < y + h; yy += s, r++) {
      for (let xx = x, c = 0; xx < x + w; xx += s, c++) {
        const alt = (r + c) % 2;
        ctx.fillStyle = kind === 'checker'
          ? (alt ? P.tile2 : P.tile)
          : shade(alt ? P.tile2 : P.tile, Math.round((R() - 0.5) * 10));
        ctx.fillRect(xx, yy, s, s);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let xx = x; xx < x + w; xx += s) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
    for (let yy = y; yy < y + h; yy += s) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
    ctx.stroke();
  } else if (kind === 'marble' || kind === 'marbleDark') {
    const dark = kind === 'marbleDark';
    const s = u * 0.75;
    for (let yy = y, r = 0; yy < y + h; yy += s, r++) {
      for (let xx = x, c = 0; xx < x + w; xx += s, c++) {
        ctx.fillStyle = dark ? shade('#26252a', (r + c) % 2 ? 6 : -4) : shade('#f2eee8', (r + c) % 2 ? -6 : 2);
        ctx.fillRect(xx, yy, s, s);
      }
    }
    ctx.strokeStyle = dark ? 'rgba(230,200,120,0.35)' : 'rgba(120,110,100,0.22)';
    ctx.lineWidth = 0.8;
    const n = Math.round((w * h) / (u * u) * 2.2);
    for (let i = 0; i < n; i++) {
      const sx = x + R() * w, sy = y + R() * h;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx + u * 0.3, sy + u * (R() - 0.5) * 0.4, sx + u * 0.5, sy + u * (R() - 0.5) * 0.5, sx + u * (0.6 + R() * 0.5), sy + u * (R() - 0.5) * 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = dark ? 'rgba(244,200,66,0.5)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    for (let xx = x; xx < x + w; xx += s) { ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); }
    for (let yy = y; yy < y + h; yy += s) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
    ctx.stroke();
  } else if (kind === 'tatami' || kind === 'tatamiGold') {
    ctx.fillStyle = P.tatami; ctx.fillRect(x, y, w, h);
    const mw = u * 1.0, mh = u * 0.5;
    const edge = kind === 'tatamiGold' ? P.gold : (P.lux >= 3 ? '#2a3550' : '#3e4a32');
    const ew = Math.max(1.2, u * 0.035);
    for (let yy = y, r = 0; yy < y + h; yy += mh, r++) {
      const off = (r % 2) * mw * 0.5;
      for (let xx = x - off, c = 0; xx < x + w; xx += mw, c++) {
        ctx.fillStyle = shade(P.tatami, ((r + c) % 3) * 4 - 4);
        ctx.fillRect(xx + 1, yy + 1, mw - 2, mh - 2);
        ctx.strokeStyle = 'rgba(80,70,20,0.12)'; ctx.lineWidth = 0.6;
        ctx.beginPath();
        for (let k = 3; k < mw; k += 3) { ctx.moveTo(xx + k, yy + 2); ctx.lineTo(xx + k, yy + mh - 2); }
        ctx.stroke();
        if (kind === 'tatamiGold') {
          const ew2 = ew * 1.6;
          ctx.fillStyle = '#7a0e12'; ctx.fillRect(xx, yy, mw, ew2); ctx.fillRect(xx, yy + mh - ew2, mw, ew2);
          ctx.fillStyle = P.gold; ctx.fillRect(xx, yy + ew2 * 0.4, mw, 0.8); ctx.fillRect(xx, yy + mh - ew2 * 0.6, mw, 0.8);
        } else {
          ctx.fillStyle = edge;
          ctx.fillRect(xx, yy, mw, ew);
          ctx.fillRect(xx, yy + mh - ew, mw, ew);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(xx, yy, 1, mh);
      }
    }
  } else if (kind === 'carpet') {
    ctx.fillStyle = P.carpet; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let yy = y; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1);
    if (P.lux >= 2) {
      ctx.strokeStyle = P.gold; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.strokeRect(x + u * 0.12, y + u * 0.12, w - u * 0.24, h - u * 0.24);
      ctx.globalAlpha = 1;
    }
  } else if (kind === 'stone') {
    ctx.fillStyle = shade(P.tile, -30); ctx.fillRect(x, y, w, h);
    const s = u * 0.45;
    for (let yy = y, r = 0; yy < y + h; yy += s * 0.6, r++) {
      for (let xx = x - (r % 2) * s * 0.5; xx < x + w; xx += s) {
        box(ctx, xx + 1, yy + 1, s - 2, s * 0.6 - 2, 2, shade(P.tile, Math.round((R() - 0.5) * 20)));
      }
    }
  } else if (kind === 'lacquer') {
    ctx.fillStyle = '#1c120c'; ctx.fillRect(x, y, w, h);
    const pw = u * 0.5;
    for (let yy = y; yy < y + h; yy += pw) {
      const gr = ctx.createLinearGradient(x, yy, x, yy + pw);
      gr.addColorStop(0, '#4a2a1a'); gr.addColorStop(1, '#1e110a');
      ctx.fillStyle = gr; ctx.fillRect(x, yy, w, pw - 1);
      ctx.fillStyle = 'rgba(244,200,66,0.55)'; ctx.fillRect(x, yy + pw - 1, w, 1);
    }
  } else if (kind === 'deck') {
    ctx.fillStyle = '#9a7656'; ctx.fillRect(x, y, w, h);
    const pw = u * 0.18;
    for (let xx = x; xx < x + w; xx += pw) {
      ctx.fillStyle = shade('#9a7656', Math.round((R() - 0.5) * 16));
      ctx.fillRect(xx, y, pw - 1, h);
    }
  }
  ctx.restore();
}

/* ---------------- light pass ---------------- */
function addLight(g, x, y, r, color, a = 0.5) { g.lights.push({ x, y, r, color, a }); }
function flushLights(g) {
  const { ctx } = g;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of g.lights) {
    const gr = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    gr.addColorStop(0, L.color.replace('A', String(L.a * (g.lightK || 1))));
    gr.addColorStop(1, L.color.replace('A', '0'));
    ctx.fillStyle = gr;
    ctx.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  ctx.restore();
  g.lights = [];
}

/* Item: {t, x, y, w, h, f} in room-cell units (0..3).
 * f = facing: 'd' back to top wall (default), 'u' back to bottom, 'r' back to left, 'l' back to right */
function withFace(g, it, fn) {
  const { ctx, u } = g;
  const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = (it.h ?? it.w) * u;
  if (!it.flat) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    rr(ctx, X + u * 0.05, Y + u * 0.07, W, H, u * 0.08); ctx.fill();
  }
  const f = it.f || 'd';
  const rot = f === 'd' ? 0 : f === 'u' ? Math.PI : f === 'r' ? -Math.PI / 2 : Math.PI / 2;
  const lw = (f === 'd' || f === 'u') ? W : H;
  const lh = (f === 'd' || f === 'u') ? H : W;
  ctx.save();
  ctx.translate(X + W / 2, Y + H / 2);
  ctx.rotate(rot);
  ctx.translate(-lw / 2, -lh / 2);
  fn(ctx, lw, lh, u);
  ctx.restore();
  return { X, Y, W, H };
}

const DRAW = {
  rug(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    const c = it.c || P.rug, b = it.b || P.rugB;
    if (it.round) {
      ctx.beginPath(); ctx.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
      ctx.strokeStyle = b; ctx.lineWidth = Math.max(1.5, u * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(X + W / 2, Y + H / 2, W / 2 - u * 0.12, H / 2 - u * 0.12, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      return;
    }
    box(ctx, X, Y, W, H, u * 0.04, c);
    const pat = it.pat || 'border';
    ctx.lineWidth = Math.max(1.2, u * 0.04);
    ctx.strokeStyle = b;
    ctx.strokeRect(X + u * 0.08, Y + u * 0.08, W - u * 0.16, H - u * 0.16);
    if (pat === 'persian') {
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
      ctx.strokeRect(X + u * 0.16, Y + u * 0.16, W - u * 0.32, H - u * 0.32);
      const cx = X + W / 2, cy = Y + H / 2;
      ctx.fillStyle = b; ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.22); ctx.lineTo(cx + W * 0.2, cy); ctx.lineTo(cx, cy + H * 0.22); ctx.lineTo(cx - W * 0.2, cy);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      circ(ctx, cx, cy, Math.min(W, H) * 0.07, c);
      for (const [ax, ay] of [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82], [0.82, 0.82]]) circ(ctx, X + W * ax, Y + H * ay, u * 0.05, b);
      ctx.strokeStyle = 'rgba(255,245,220,0.7)'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let yy = Y + 2; yy < Y + H - 1; yy += 3) { ctx.moveTo(X, yy); ctx.lineTo(X - u * 0.05, yy); ctx.moveTo(X + W, yy); ctx.lineTo(X + W + u * 0.05, yy); }
      ctx.stroke();
    } else if (pat === 'stripe') {
      ctx.fillStyle = b; ctx.globalAlpha = 0.45;
      for (let yy = Y + u * 0.2; yy < Y + H - u * 0.15; yy += u * 0.22) ctx.fillRect(X + u * 0.12, yy, W - u * 0.24, u * 0.06);
      ctx.globalAlpha = 1;
    } else if (pat === 'quilt') {
      const s = u * 0.3;
      ctx.globalAlpha = 0.8;
      for (let yy = Y + u * 0.1, r = 0; yy < Y + H - u * 0.12; yy += s, r++) {
        for (let xx = X + u * 0.1, ci = 0; xx < X + W - u * 0.12; xx += s, ci++) {
          ctx.fillStyle = (r + ci) % 2 ? b : c;
          ctx.fillRect(xx, yy, Math.min(s, X + W - u * 0.1 - xx), Math.min(s, Y + H - u * 0.1 - yy));
        }
      }
      ctx.globalAlpha = 1;
    } else if (pat === 'mat') {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let xx = X + 3; xx < X + W - 2; xx += 3) ctx.fillRect(xx, Y + 2, 1, H - 4);
    } else if (pat === 'red') {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let yy = Y; yy < Y + H; yy += 2) ctx.fillRect(X, yy, W, 1);
    }
  },
  bed(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const frame = it.frame || P.wood;
      solid(ctx, 0, 0, w, h, u * 0.08, frame, u);
      box(ctx, 0, 0, w, h * 0.13, u * 0.06, shade(frame, -20));
      if (P.lux >= 2) { ctx.fillStyle = P.gold; ctx.fillRect(w * 0.1, h * 0.05, w * 0.8, Math.max(1, u * 0.025)); }
      box(ctx, w * 0.07, h * 0.12, w * 0.86, h * 0.82, u * 0.06, '#f4f0e6');
      const n = w > u * 1.2 ? 2 : 1;
      const pw = (w * 0.78) / n;
      for (let i = 0; i < n; i++) box(ctx, w * 0.11 + i * pw, h * 0.16, pw - w * 0.04, h * 0.14, u * 0.05, '#ffffff', 'rgba(0,0,0,0.12)');
      const bc = it.c || P.fab;
      box(ctx, w * 0.06, h * 0.38, w * 0.88, h * 0.56, u * 0.05, bc);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(w * 0.06, h * 0.38, w * 0.88, h * 0.07);
      if (it.pat === 'check') {
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = 0.2; k < 1; k += 0.2) { ctx.moveTo(w * k, h * 0.45); ctx.lineTo(w * k, h * 0.92); }
        for (let k = 0.55; k < 0.94; k += 0.12) { ctx.moveTo(w * 0.08, h * k); ctx.lineTo(w * 0.92, h * k); }
        ctx.stroke();
      }
      if (P.lux >= 3) { ctx.strokeStyle = P.gold; ctx.lineWidth = 1; ctx.strokeRect(w * 0.1, h * 0.48, w * 0.8, h * 0.42); }
      if (it.canopy) {
        ctx.strokeStyle = P.gold; ctx.lineWidth = Math.max(1.2, u * 0.035);
        ctx.strokeRect(-u * 0.02, -u * 0.02, w + u * 0.04, h + u * 0.04);
        for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) circ(ctx, cx, cy, u * 0.05, P.gold);
        ctx.fillStyle = 'rgba(255,240,230,0.22)';
        ctx.fillRect(0, 0, w * 0.12, h); ctx.fillRect(w * 0.88, 0, w * 0.12, h);
      }
    });
  },
  futon(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      box(ctx, 0, 0, w, h, u * 0.06, '#f3efe4', 'rgba(0,0,0,0.15)');
      box(ctx, w * 0.2, h * 0.04, w * 0.6, h * 0.14, u * 0.05, '#e8dcc0', 'rgba(0,0,0,0.15)');
      const bc = it.c || P.fab;
      box(ctx, w * 0.02, h * 0.3, w * 0.96, h * 0.68, u * 0.05, bc);
      ctx.strokeStyle = it.gold ? P.gold : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { ctx.moveTo(w * 0.1 + k * w * 0.22, h * 0.36); ctx.lineTo(w * 0.2 + k * w * 0.22, h * 0.9); }
      ctx.stroke();
      if (it.gold) { ctx.lineWidth = 1.5; ctx.strokeRect(w * 0.05, h * 0.33, w * 0.9, h * 0.62); }
    });
  },
  night(g, it) {
    const { P } = g;
    const r = withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.04, P.wood, u);
      if (P.lux >= 2) { ctx.fillStyle = P.gold; ctx.fillRect(w * 0.42, h * 0.62, w * 0.16, Math.max(1, u * 0.03)); }
      circ(ctx, w / 2, h * 0.4, Math.min(w, h) * 0.26, '#f6e6b0', 'rgba(0,0,0,0.25)');
    });
    addLight(g, r.X + r.W / 2, r.Y + r.H * 0.4, g.u * (0.5 + P.lux * 0.06), 'rgba(255,214,140,A)', 0.35);
  },
  sofa(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const c = it.c || P.fab;
      box(ctx, 0, 0, w, h, u * 0.1, shade(c, -30));
      box(ctx, 0, 0, w, h * 0.32, u * 0.1, shade(c, -12));
      box(ctx, 0, 0, w * 0.13, h, u * 0.08, shade(c, -18));
      box(ctx, w * 0.87, 0, w * 0.13, h, u * 0.08, shade(c, -18));
      const n = it.n || Math.max(2, Math.round((w / u) * 1.4));
      const sw = (w * 0.74) / n;
      for (let i = 0; i < n; i++) box(ctx, w * 0.13 + i * sw + 1, h * 0.3, sw - 2, h * 0.62, u * 0.06, c);
      if (it.L) box(ctx, w * 0.72, h * 0.3, w * 0.28, h * 1.1, u * 0.08, c, shade(c, -30));
      if (n > 1) { circ(ctx, w * 0.24, h * 0.36, u * 0.08, it.pc || P.fab3); circ(ctx, w * 0.76, h * 0.36, u * 0.08, it.pc || P.fab3); }
      if (P.lux >= 2) { ctx.strokeStyle = P.gold; ctx.lineWidth = 1; rr(ctx, 1, 1, w - 2, h - 2, u * 0.1); ctx.stroke(); }
    });
  },
  chair(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      const c = it.c || g.P.wood;
      box(ctx, 0, 0, w, h * 0.3, u * 0.05, shade(c, -25));
      box(ctx, w * 0.05, h * 0.22, w * 0.9, h * 0.75, u * 0.06, c);
      if (it.cush) box(ctx, w * 0.15, h * 0.35, w * 0.7, h * 0.5, u * 0.05, it.cush);
    });
  },
  armchair(g, it) { DRAW.sofa(g, { ...it, n: 1 }); },
  table(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    const chairs = it.chairs || 0;
    const cc = it.cc || P.wood, cush = it.cush;
    const put = (cx, cy, f) => DRAW.chair(g, { x: (cx - g.rx) / u - 0.15, y: (cy - g.ry) / u - 0.15, w: 0.3, h: 0.3, f, c: cc, cush });
    if (chairs) {
      const along = Math.max(1, Math.round(chairs / 2));
      for (let i = 0; i < along; i++) {
        const cx = X + W * ((i + 0.5) / along);
        if (!it.noTop) put(cx, Y - u * 0.1, 'u');
        put(cx, Y + H + u * 0.1, 'd');
      }
      if (it.ends) { put(X - u * 0.1, Y + H / 2, 'l'); put(X + W + u * 0.1, Y + H / 2, 'r'); }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    if (it.round) { ctx.beginPath(); ctx.ellipse(X + W / 2 + u * 0.05, Y + H / 2 + u * 0.07, W / 2, H / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else { rr(ctx, X + u * 0.05, Y + u * 0.07, W, H, u * 0.05); ctx.fill(); }
    const top = it.c || P.woodLt;
    if (it.round) {
      ctx.beginPath(); ctx.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = top; ctx.fill();
      ctx.strokeStyle = shade(top, -40); ctx.lineWidth = 1.2; ctx.stroke();
    } else solid(ctx, X, Y, W, H, u * 0.05, top, u);
    if (it.cloth) box(ctx, X + W * 0.08, Y + H * 0.1, W * 0.84, H * 0.8, u * 0.04, it.cloth);
    if (P.lux >= 2 && !it.plain) {
      ctx.strokeStyle = P.gold; ctx.lineWidth = 1;
      if (it.round) { ctx.beginPath(); ctx.ellipse(X + W / 2, Y + H / 2, W / 2 - 2, H / 2 - 2, 0, 0, Math.PI * 2); ctx.stroke(); }
      else ctx.strokeRect(X + 2, Y + 2, W - 4, H - 4);
    }
    if (it.set) {
      const n = Math.max(1, Math.round(chairs / 2));
      for (let i = 0; i < n; i++) {
        const cx = X + W * ((i + 0.5) / n);
        circ(ctx, cx, Y + H * 0.28, u * 0.07, '#fbfbf6', 'rgba(0,0,0,0.2)');
        circ(ctx, cx, Y + H * 0.72, u * 0.07, '#fbfbf6', 'rgba(0,0,0,0.2)');
      }
    }
    if (it.vase) {
      circ(ctx, X + W / 2, Y + H / 2, u * 0.08, it.vase);
      circ(ctx, X + W / 2 - u * 0.04, Y + H / 2 - u * 0.03, u * 0.04, '#e96a8a');
      circ(ctx, X + W / 2 + u * 0.04, Y + H / 2, u * 0.04, '#f6d36a');
    }
    if (it.candle) {
      for (const k of [0.25, 0.75]) {
        circ(ctx, X + W * k, Y + H / 2, u * 0.04, P.gold);
        addLight(g, X + W * k, Y + H / 2, u * 0.45, 'rgba(255,200,110,A)', 0.4);
      }
    }
  },
  lowtable(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    const zc = it.zc || P.fab;
    const z = u * 0.34;
    const zab = (cx, cy) => { box(ctx, cx - z / 2, cy - z / 2, z, z, u * 0.07, zc, shade(zc, -35)); circ(ctx, cx, cy, u * 0.025, P.lux >= 4 ? P.gold : shade(zc, 40)); };
    const n = it.n ?? 4;
    if (n >= 1) zab(X + W / 2, Y + H + z * 0.55);
    if (n >= 2) zab(X + W / 2, Y - z * 0.55);
    if (n >= 3) zab(X - z * 0.55, Y + H / 2);
    if (n >= 4) zab(X + W + z * 0.55, Y + H / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, X + u * 0.04, Y + u * 0.06, W, H, u * 0.04); ctx.fill();
    solid(ctx, X, Y, W, H, u * 0.04, it.c || P.woodDk, u);
    if (P.lux >= 4) { ctx.strokeStyle = P.gold; ctx.lineWidth = 1.2; ctx.strokeRect(X + 2, Y + 2, W - 4, H - 4); }
    circ(ctx, X + W * 0.35, Y + H * 0.5, u * 0.045, '#e8e2d2', 'rgba(0,0,0,0.3)');
    circ(ctx, X + W * 0.65, Y + H * 0.5, u * 0.045, '#e8e2d2', 'rgba(0,0,0,0.3)');
  },
  tv(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.03, it.c || P.woodDk, u);
      box(ctx, w * 0.12, h * 0.05, w * 0.76, h * 0.3, 1, '#14161a');
      ctx.fillStyle = 'rgba(120,180,255,0.35)'; ctx.fillRect(w * 0.14, h * 0.07, w * 0.3, h * 0.08);
      if (P.lux >= 4) { box(ctx, w * 0.02, h * 0.1, w * 0.08, h * 0.6, 1, '#222'); box(ctx, w * 0.9, h * 0.1, w * 0.08, h * 0.6, 1, '#222'); }
    });
  },
  counter(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const top = it.top || (P.lux >= 4 ? '#e9e6e0' : P.lux >= 2 ? '#2e2a28' : '#d9d4c8');
      solid(ctx, 0, 0, w, h, u * 0.03, top, u);
      ctx.fillStyle = it.body || P.wood; ctx.fillRect(0, h * 0.86, w, h * 0.14);
      if (it.sink !== false) {
        box(ctx, w * 0.08, h * 0.18, u * 0.42, h * 0.56, u * 0.06, '#b8c2c8', '#7d878d');
        circ(ctx, w * 0.08 + u * 0.21, h * 0.12, u * 0.035, '#8c969c');
      }
      if (it.stove !== false) {
        const sx = w - u * 0.62;
        box(ctx, sx, h * 0.12, u * 0.5, h * 0.7, 2, '#26282c');
        for (const [a, b] of [[0.27, 0.32], [0.73, 0.32], [0.27, 0.68], [0.73, 0.68]]) circ(ctx, sx + u * 0.5 * a, h * 0.12 + h * 0.7 * b, u * 0.07, null, '#9aa0a8', 1);
        if (it.pot) circ(ctx, sx + u * 0.135, h * 0.33, u * 0.09, '#c0583a', '#5a2a1a');
      }
      if (w > u * 1.4) box(ctx, w * 0.45, h * 0.25, u * 0.26, h * 0.4, 2, '#d8b07a');
      if (P.lux >= 4) { ctx.fillStyle = P.gold; ctx.fillRect(0, h * 0.84, w, Math.max(1, u * 0.025)); }
    });
  },
  fridge(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.05, it.c || (P.lux >= 4 ? '#c9ccd2' : '#eef0f0'), u);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(w * 0.5, h * 0.2, 1, h * 0.65);
      ctx.fillRect(w * 0.42, h * 0.55, 1, h * 0.25); ctx.fillRect(w * 0.58, h * 0.55, 1, h * 0.25);
    });
  },
  kamado(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.1, '#b5a48a', u);
      const n = it.n || 2;
      for (let i = 0; i < n; i++) {
        const cx = w * ((i + 0.5) / n), r = Math.min(w / n, h) * 0.3;
        circ(ctx, cx, h * 0.45, r, '#2a2420');
        circ(ctx, cx, h * 0.45, r * 0.75, '#5a4a3a');
        circ(ctx, cx - u * 0.04, h * 0.42, u * 0.03, '#b8a888');
      }
      ctx.fillStyle = '#e07a2a'; ctx.fillRect(w * 0.3, h * 0.86, w * 0.4, h * 0.08);
    });
    addLight(g, g.rx + (it.x + it.w / 2) * g.u, g.ry + (it.y + it.h) * g.u, g.u * 0.5, 'rgba(255,140,60,A)', 0.3);
  },
  tub(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const jp = it.hinoki;
      const rim = jp ? '#d9b986' : P.lux >= 4 ? '#f4f0ea' : '#f1f3f4';
      solid(ctx, 0, 0, w, h, jp ? u * 0.04 : u * 0.2, rim, u);
      const gr = ctx.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#9fd8ec'); gr.addColorStop(1, '#5fb2d4');
      box(ctx, w * 0.1, h * 0.14, w * 0.8, h * 0.72, jp ? u * 0.03 : u * 0.16, gr);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(w * 0.4, h * 0.45, u * 0.12, 0.3, 2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(w * 0.62, h * 0.6, u * 0.08, 0.3, 2.2); ctx.stroke();
      if (jp) { ctx.strokeStyle = 'rgba(120,80,40,0.45)'; ctx.beginPath(); for (let k = 0.25; k < 1; k += 0.25) { ctx.moveTo(w * k, 0); ctx.lineTo(w * k, h * 0.12); } ctx.stroke(); }
      if (P.lux >= 3) circ(ctx, w * 0.5, h * 0.08, u * 0.04, P.gold);
    });
  },
  sink(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.04, P.lux >= 4 ? '#e9e6e0' : P.jp ? '#8a6a4a' : '#e6e2da', u);
      box(ctx, w * 0.25, h * 0.2, w * 0.5, h * 0.55, u * 0.1, '#ffffff', '#9aa4aa');
      circ(ctx, w / 2, h * 0.12, u * 0.03, P.lux >= 3 ? P.gold : '#9aa4aa');
      ctx.fillStyle = P.lux >= 3 ? P.gold : '#b8d4e0'; ctx.fillRect(w * 0.1, 0, w * 0.8, Math.max(1.5, u * 0.04));
    });
  },
  toilet(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      box(ctx, w * 0.2, 0, w * 0.6, h * 0.3, u * 0.04, '#f2f2ee', 'rgba(0,0,0,0.25)');
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.6, w * 0.3, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fbfbf8'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(w / 2, h * 0.62, w * 0.18, h * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d9e8ee'; ctx.fill();
    });
  },
  washer(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.05, '#eceeef', u);
      circ(ctx, w / 2, h * 0.55, Math.min(w, h) * 0.3, '#9fb6c4', '#6c7e88', 1.5);
    });
  },
  shelf(g, it) {
    const { P } = g;
    const R = rng(g.seed + Math.round(it.x * 31 + it.y * 17));
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.02, it.c || P.woodDk, u);
      const cols = ['#a33b3b', '#2f5f8a', '#d0a040', '#3d7a4a', '#6a4a8a', '#e0d4b8', '#2a2a2a'];
      let bx = w * 0.04;
      while (bx < w * 0.95) {
        const bw = u * (0.05 + R() * 0.05);
        ctx.fillStyle = cols[Math.floor(R() * cols.length)];
        ctx.fillRect(bx, h * 0.12, Math.min(bw, w * 0.96 - bx) - 0.6, h * (0.5 + R() * 0.25));
        bx += bw;
        if (R() < 0.08) bx += u * 0.08;
      }
      if (P.lux >= 2) { ctx.fillStyle = P.gold; ctx.fillRect(0, h - Math.max(1, u * 0.03), w, Math.max(1, u * 0.03)); }
    });
  },
  desk(g, it) {
    const { P } = g;
    const r = withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h * 0.7, u * 0.03, it.c || P.wood, u);
      box(ctx, w * 0.1, h * 0.12, w * 0.32, h * 0.3, 1, '#f5f2ea', 'rgba(0,0,0,0.15)');
      if (it.pc) box(ctx, w * 0.5, h * 0.06, w * 0.3, h * 0.22, 1, '#20242a');
      circ(ctx, w * 0.88, h * 0.18, u * 0.06, '#f6e3a0', 'rgba(0,0,0,0.3)');
      box(ctx, w * 0.32, h * 0.72, w * 0.36, h * 0.28, u * 0.06, it.cc || P.fab2);
    });
    addLight(g, r.X + r.W / 2, r.Y + r.H / 2, g.u * 0.55, 'rgba(255,220,150,A)', 0.25);
  },
  wardrobe(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.03, it.c || P.wood, u);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      const n = Math.max(2, Math.round((w / u) * 2));
      for (let i = 1; i < n; i++) ctx.fillRect((w * i) / n, h * 0.1, 1, h * 0.8);
      for (let i = 0; i < n; i++) circ(ctx, (w * (i + 0.5)) / n + (i % 2 ? -u * 0.08 : u * 0.08), h * 0.75, u * 0.025, P.lux >= 2 ? P.gold : '#ddd');
    });
  },
  dresser(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.03, it.c || P.wood, u);
      box(ctx, w * 0.25, 0, w * 0.5, h * 0.35, u * 0.08, P.lux >= 2 ? P.gold : '#c9d8e0');
      box(ctx, w * 0.29, h * 0.03, w * 0.42, h * 0.27, u * 0.06, '#d6e6ee');
      circ(ctx, w * 0.15, h * 0.6, u * 0.05, '#e8a0b8');
    });
  },
  plant(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u, r = (it.r || 0.22) * u;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(cx + u * 0.05, cy + u * 0.07, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    circ(ctx, cx, cy, r * 0.62, it.pot || (P.lux >= 4 ? '#f0ece6' : P.lux >= 2 ? '#7a3a2a' : '#b86a44'), 'rgba(0,0,0,0.3)');
    const R = rng(g.seed + Math.round(cx * 7 + cy));
    const leaves = it.palm ? 7 : 6;
    const base = it.c || '#4f8a45';
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + R();
      const lr = r * (it.palm ? 0.95 : 0.6);
      ctx.fillStyle = shade(base, Math.round((R() - 0.5) * 30));
      ctx.beginPath();
      if (it.palm) ctx.ellipse(cx + Math.cos(a) * lr * 0.55, cy + Math.sin(a) * lr * 0.55, lr * 0.55, lr * 0.18, a, 0, Math.PI * 2);
      else ctx.arc(cx + Math.cos(a) * lr * 0.5, cy + Math.sin(a) * lr * 0.5, lr * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    circ(ctx, cx, cy, r * 0.25, shade(base, 25));
  },
  bonsai(g, it) {
    const { ctx, u } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    box(ctx, cx - u * 0.18, cy - u * 0.1, u * 0.36, u * 0.2, 2, '#3a2a20');
    ctx.strokeStyle = '#5a3a22'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(cx - u * 0.1, cy - u * 0.1, cx + u * 0.04, cy - u * 0.18); ctx.stroke();
    for (const [dx, dy] of [[-0.12, -0.12], [0.08, -0.2], [0.14, -0.08]]) circ(ctx, cx + dx * u, cy + dy * u, u * 0.08, '#3f6b38');
  },
  lamp(g, it) {
    const { ctx, u } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx + u * 0.03, cy + u * 0.04, u * 0.12, 'rgba(0,0,0,0.25)');
    circ(ctx, cx, cy, u * 0.12, it.c || '#f4e2b0', 'rgba(0,0,0,0.3)');
    circ(ctx, cx, cy, u * 0.05, '#fff6d0');
    addLight(g, cx, cy, u * (it.r || 0.8), 'rgba(255,214,140,A)', 0.4);
  },
  chandelier(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    const r = (it.r || 0.38) * u;
    addLight(g, cx, cy, r * 3.2, 'rgba(255,226,160,A)', 0.42);
    g.post.push(() => {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = P.gold; ctx.lineWidth = Math.max(1, u * 0.03);
      const arms = it.arms || 6;
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
        circ(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, u * 0.045, '#fff4c8');
      }
      circ(ctx, cx, cy, r * 0.55, null, P.gold, Math.max(1, u * 0.025));
      circ(ctx, cx, cy, u * 0.07, '#fff8dc', P.gold);
      ctx.restore();
    });
  },
  pendant(g, it) {
    const { ctx, u } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    addLight(g, cx, cy, u * (it.r || 1.1), 'rgba(255,236,190,A)', 0.22);
    g.post.push(() => { circ(ctx, cx, cy, u * 0.09, 'rgba(255,250,230,0.85)', 'rgba(0,0,0,0.25)'); });
  },
  fireplace(g, it) {
    const { P } = g;
    const r = withFace(g, it, (ctx, w, h, u) => {
      const c = it.c || '#d8cfc0';
      solid(ctx, 0, 0, w, h, u * 0.03, c, u);
      box(ctx, w * 0.22, 0, w * 0.56, h * 0.62, u * 0.12, '#1a1412');
      const fl = ctx.createRadialGradient(w / 2, h * 0.42, 1, w / 2, h * 0.42, w * 0.25);
      fl.addColorStop(0, '#fff2a0'); fl.addColorStop(0.5, '#ff9a2a'); fl.addColorStop(1, 'rgba(200,40,10,0)');
      ctx.fillStyle = fl; ctx.fillRect(w * 0.22, 0, w * 0.56, h * 0.62);
      if (P.lux >= 2) { ctx.fillStyle = P.gold; ctx.fillRect(0, h * 0.64, w, Math.max(1.5, u * 0.04)); }
      box(ctx, w * 0.12, h * 0.7, w * 0.76, h * 0.26, 2, shade(c, -30));
    });
    addLight(g, r.X + r.W / 2, r.Y + r.H / 2, g.u * 1.4, 'rgba(255,150,60,A)', 0.4);
  },
  piano(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      ctx.beginPath();
      ctx.moveTo(w * 0.08, 0); ctx.lineTo(w, 0); ctx.lineTo(w, h * 0.55);
      ctx.bezierCurveTo(w, h * 1.0, w * 0.45, h * 0.75, w * 0.35, h);
      ctx.lineTo(w * 0.08, h); ctx.closePath();
      ctx.fillStyle = it.c || '#121214'; ctx.fill();
      ctx.strokeStyle = P.lux >= 4 ? P.gold : '#555'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(w * 0.18, h * 0.1, w * 0.6, h * 0.08);
      box(ctx, 0, h * 0.05, w * 0.1, h * 0.9, 1, '#f6f6f2', '#222');
      ctx.fillStyle = '#222';
      for (let k = 0.1; k < 0.95; k += 0.09) ctx.fillRect(0, h * k, w * 0.06, 1);
    });
  },
  bar(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h * 0.3, 2, '#2a2420', u);
      const cols = ['#4aa86a', '#c84a3a', '#e8c06a', '#6a8ad8', '#e8e8e8'];
      for (let i = 0; i < Math.floor(w / (u * 0.13)); i++) circ(ctx, u * 0.1 + i * u * 0.13, h * 0.14, u * 0.045, cols[i % cols.length]);
      solid(ctx, 0, h * 0.42, w, h * 0.26, u * 0.05, '#2a2a30', u);
      ctx.fillStyle = P.gold; ctx.fillRect(0, h * 0.42, w, Math.max(1.2, u * 0.035));
      for (let i = 0; i < Math.floor(w / (u * 0.45)); i++) circ(ctx, u * 0.25 + i * u * 0.45, h * 0.86, u * 0.1, '#c9a46a', '#3a3030');
    });
    addLight(g, g.rx + (it.x + it.w / 2) * g.u, g.ry + (it.y + it.h / 2) * g.u, g.u * 1.1, 'rgba(255,190,110,A)', 0.3);
  },
  pool(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    box(ctx, X, Y, W, H, u * 0.08, '#f4f0e8');
    const gr = ctx.createLinearGradient(X, Y, X + W, Y + H);
    gr.addColorStop(0, '#5fd0e8'); gr.addColorStop(1, '#1f8fb8');
    box(ctx, X + u * 0.1, Y + u * 0.1, W - u * 0.2, H - u * 0.2, u * 0.06, gr);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const yy = Y + H * (0.25 + k * 0.17);
      ctx.beginPath(); ctx.moveTo(X + u * 0.2, yy);
      ctx.bezierCurveTo(X + W * 0.35, yy - 3, X + W * 0.6, yy + 3, X + W - u * 0.2, yy);
      ctx.stroke();
    }
    ctx.strokeStyle = P.gold; ctx.lineWidth = 1.2; rr(ctx, X + u * 0.1, Y + u * 0.1, W - u * 0.2, H - u * 0.2, u * 0.06); ctx.stroke();
    ctx.strokeStyle = '#c9ccd2'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X + W * 0.75, Y + u * 0.04); ctx.lineTo(X + W * 0.75, Y + u * 0.22); ctx.moveTo(X + W * 0.85, Y + u * 0.04); ctx.lineTo(X + W * 0.85, Y + u * 0.22); ctx.stroke();
    addLight(g, X + W / 2, Y + H / 2, Math.max(W, H) * 0.7, 'rgba(80,200,255,A)', 0.18);
  },
  lounger(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      box(ctx, 0, 0, w, h, u * 0.05, '#f2ede2', 'rgba(0,0,0,0.2)');
      box(ctx, 0, 0, w, h * 0.3, u * 0.05, '#e2d8c4');
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0.4; k < 1; k += 0.15) { ctx.moveTo(w * 0.1, h * k); ctx.lineTo(w * 0.9, h * k); }
      ctx.stroke();
      box(ctx, w * 0.2, h * 0.05, w * 0.6, h * 0.15, 2, it.c || '#2aa3b2');
    });
  },
  billiard(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(ctx, X + u * 0.05, Y + u * 0.07, W, H, 3); ctx.fill();
    box(ctx, X, Y, W, H, u * 0.06, P.woodDk);
    box(ctx, X + u * 0.1, Y + u * 0.1, W - u * 0.2, H - u * 0.2, 2, '#2f7a4a');
    for (const [a, b] of [[0, 0], [0.5, 0], [1, 0], [0, 1], [0.5, 1], [1, 1]]) circ(ctx, X + u * 0.1 + (W - u * 0.2) * a, Y + u * 0.1 + (H - u * 0.2) * b, u * 0.04, '#111');
    ['#f2f2f2', '#e8c030', '#2a5ac8', '#c83a2a'].forEach((c, i) => circ(ctx, X + W * (0.3 + i * 0.1), Y + H * (0.4 + (i % 2) * 0.15), u * 0.035, c));
    ctx.strokeStyle = P.gold; ctx.lineWidth = 1; ctx.strokeRect(X + 1, Y + 1, W - 2, H - 2);
  },
  art(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    box(ctx, X, Y, W, H, 1, it.frame || P.gold);
    const m = Math.min(W, H) * 0.22;
    const gr = ctx.createLinearGradient(X + m, Y + m, X + W - m, Y + H - m);
    const pal = it.pal || ['#3a6ea8', '#e8b060', '#4a8a5a'];
    gr.addColorStop(0, pal[0]); gr.addColorStop(0.5, pal[1]); gr.addColorStop(1, pal[2]);
    ctx.fillStyle = gr; ctx.fillRect(X + m, Y + m, W - m * 2, H - m * 2);
    if (it.spot) addLight(g, X + W / 2, Y + H / 2, u * 0.6, 'rgba(255,240,200,A)', 0.3);
  },
  statue(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx + u * 0.04, cy + u * 0.06, u * 0.2, 'rgba(0,0,0,0.25)');
    box(ctx, cx - u * 0.18, cy - u * 0.18, u * 0.36, u * 0.36, 2, it.base || '#2a2a2e');
    circ(ctx, cx, cy, u * 0.12, it.c || '#f4f2ee', 'rgba(0,0,0,0.3)');
    circ(ctx, cx - u * 0.03, cy - u * 0.04, u * 0.05, '#ffffff');
    if (P.lux >= 4) { ctx.strokeStyle = P.gold; ctx.lineWidth = 1; ctx.strokeRect(cx - u * 0.18, cy - u * 0.18, u * 0.36, u * 0.36); }
    addLight(g, cx, cy, u * 0.5, 'rgba(255,245,220,A)', 0.2);
  },
  shoebox(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, 0, w, h, u * 0.03, it.c || P.woodLt, u);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let k = 1; k < 3; k++) ctx.fillRect((w * k) / 3, h * 0.15, 1, h * 0.7);
      circ(ctx, w * 0.8, h * 0.4, u * 0.06, '#7fb0d8');
    });
  },
  shoes(g, it) {
    const { ctx, u } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u;
    const cs = ['#3a3a3a', '#8a4a2a', '#e8e8e8'];
    for (let i = 0; i < (it.n || 2); i++) {
      ctx.fillStyle = cs[i % 3];
      ctx.beginPath(); ctx.ellipse(X + i * u * 0.2, Y, u * 0.045, u * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(X + i * u * 0.2 + u * 0.08, Y, u * 0.045, u * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    }
  },
  umbrella(g, it) {
    const { ctx, u } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx, cy, u * 0.1, '#5a6a7a', 'rgba(0,0,0,0.3)');
    circ(ctx, cx - u * 0.03, cy - u * 0.02, u * 0.03, '#d84a4a');
    circ(ctx, cx + u * 0.03, cy + u * 0.02, u * 0.03, '#4a8ad8');
  },
  coatrack(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx + u * 0.03, cy + u * 0.05, u * 0.14, 'rgba(0,0,0,0.25)');
    circ(ctx, cx, cy, u * 0.14, null, P.woodDk, 2);
    circ(ctx, cx, cy, u * 0.04, P.woodDk);
    circ(ctx, cx + u * 0.1, cy - u * 0.06, u * 0.07, P.fab);
  },
  crate(g, it) {
    withFace(g, it, (ctx, w, h) => {
      box(ctx, 0, 0, w, h, 1, '#c9a26a', 'rgba(0,0,0,0.25)');
      ctx.fillStyle = '#e6d2a4'; ctx.fillRect(w * 0.45, 0, w * 0.1, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke();
    });
  },
  toys(g, it) {
    const { ctx, u } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u;
    const cs = ['#e84a4a', '#4a8ae8', '#f2c230', '#4ac86a'];
    for (let i = 0; i < 4; i++) box(ctx, X + (i % 2) * u * 0.16, Y + Math.floor(i / 2) * u * 0.16, u * 0.13, u * 0.13, 1, cs[i], 'rgba(0,0,0,0.25)');
    circ(ctx, X + u * 0.45, Y + u * 0.1, u * 0.1, '#ff8a3a', 'rgba(0,0,0,0.25)');
    circ(ctx, X + u * 0.42, Y + u * 0.36, u * 0.09, '#b07a4a');
    circ(ctx, X + u * 0.36, Y + u * 0.28, u * 0.035, '#b07a4a'); circ(ctx, X + u * 0.48, Y + u * 0.28, u * 0.035, '#b07a4a');
  },
  telescope(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    ctx.strokeStyle = '#3a3a40'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * u * 0.2, cy + Math.sin(a) * u * 0.2); }
    ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.7);
    box(ctx, -u * 0.06, -u * 0.32, u * 0.12, u * 0.42, 2, P.lux >= 3 ? P.gold : '#d8d8de', 'rgba(0,0,0,0.4)');
    ctx.restore();
  },
  easel(g, it) {
    withFace(g, it, (ctx, w, h, u) => {
      ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(w * 0.1, h); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.9, h); ctx.stroke();
      box(ctx, w * 0.12, h * 0.15, w * 0.76, h * 0.55, 1, '#fbf8f0', '#7a5a3a');
      circ(ctx, w * 0.4, h * 0.4, u * 0.06, '#e88a4a');
      ctx.fillStyle = '#4a8ac8'; ctx.fillRect(w * 0.2, h * 0.5, w * 0.6, h * 0.08);
    });
  },
  globe(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx + u * 0.03, cy + u * 0.05, u * 0.14, 'rgba(0,0,0,0.25)');
    circ(ctx, cx, cy, u * 0.13, '#4a7ab8', P.lux >= 2 ? P.gold : '#7a5a3a', 1.5);
    ctx.fillStyle = '#7ab86a'; ctx.beginPath(); ctx.ellipse(cx - u * 0.03, cy - u * 0.02, u * 0.06, u * 0.04, 0.5, 0, Math.PI * 2); ctx.fill();
  },
  byobu(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const n = it.n || 6;
      const pw = w / n;
      const yo = (i) => (i % 2 ? h * 0.3 : 0);
      for (let i = 0; i < n; i++) {
        const base = it.gold ? (i % 2 ? '#f6d860' : '#d9a92a') : (i % 2 ? '#efe6cc' : '#d9cfb2');
        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.moveTo(i * pw, yo(i)); ctx.lineTo((i + 1) * pw, yo(i + 1));
        ctx.lineTo((i + 1) * pw, yo(i + 1) + h * 0.6); ctx.lineTo(i * pw, yo(i) + h * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = it.gold ? '#5a2a0a' : P.woodDk; ctx.lineWidth = 1; ctx.stroke();
        if (i % 2 === 0) circ(ctx, i * pw + pw * 0.55, yo(i) + h * 0.32, Math.min(pw, h) * 0.2, it.gold ? 'rgba(40,100,60,0.75)' : 'rgba(60,90,60,0.55)');
        else if (it.gold) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(i * pw + 2, yo(i) + h * 0.38, pw * 0.75, h * 0.07); }
      }
    });
    if (it.gold) addLight(g, g.rx + (it.x + it.w / 2) * g.u, g.ry + (it.y + it.h / 2) * g.u, g.u * 1.0, 'rgba(255,210,90,A)', 0.22);
  },
  fusuma(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      const n = it.n || 4;
      for (let i = 0; i < n; i++) {
        const x = (w * i) / n;
        box(ctx, x, 0, w / n, h, 0, it.gold ? '#e8bf3c' : '#efe7d0', it.gold ? '#7a4a12' : P.woodDk, 1);
        ctx.fillStyle = it.gold ? 'rgba(255,248,200,0.5)' : 'rgba(70,100,140,0.35)';
        ctx.fillRect(x + 1, h * 0.35, w / n - 2, h * 0.25);
      }
    });
  },
  armor(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, h * 0.2, w, h * 0.8, 2, P.woodDk, u);
      box(ctx, w * 0.18, h * 0.32, w * 0.64, h * 0.5, u * 0.06, it.c || '#1e2430', P.gold);
      ctx.strokeStyle = it.lace || '#c8302a'; ctx.lineWidth = 1;
      ctx.beginPath(); for (let k = 0.42; k < 0.8; k += 0.08) { ctx.moveTo(w * 0.2, h * k); ctx.lineTo(w * 0.8, h * k); } ctx.stroke();
      circ(ctx, w / 2, h * 0.24, Math.min(w, h) * 0.2, '#14161c', P.gold);
      ctx.strokeStyle = P.gold; ctx.lineWidth = Math.max(1.5, u * 0.04);
      ctx.beginPath(); ctx.moveTo(w * 0.25, h * 0.02); ctx.quadraticCurveTo(w / 2, h * 0.22, w * 0.75, h * 0.02); ctx.stroke();
    });
  },
  katana(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      solid(ctx, 0, h * 0.3, w, h * 0.5, 2, P.woodDk, u);
      for (let i = 0; i < 2; i++) {
        const y = h * (0.15 + i * 0.35);
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = Math.max(2, u * 0.06);
        ctx.beginPath(); ctx.moveTo(w * 0.08, y + h * 0.1); ctx.quadraticCurveTo(w / 2, y - h * 0.04, w * 0.92, y + h * 0.04); ctx.stroke();
        circ(ctx, w * 0.3, y + h * 0.04, u * 0.035, P.gold);
      }
    });
  },
  andon(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    const s = u * 0.22;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(cx - s / 2 + u * 0.04, cy - s / 2 + u * 0.05, s, s);
    box(ctx, cx - s / 2, cy - s / 2, s, s, 1, '#fff2c8', P.lux >= 5 ? P.gold : P.woodDk, 1.5);
    ctx.strokeStyle = P.lux >= 5 ? P.gold : P.woodDk; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(cx, cy - s / 2); ctx.lineTo(cx, cy + s / 2); ctx.moveTo(cx - s / 2, cy); ctx.lineTo(cx + s / 2, cy); ctx.stroke();
    addLight(g, cx, cy, u * (0.75 + P.lux * 0.05), 'rgba(255,200,110,A)', 0.42);
  },
  tokonoma(g, it) {
    const { P } = g;
    withFace(g, it, (ctx, w, h, u) => {
      box(ctx, 0, 0, w, h, 1, it.gold ? '#2a160e' : '#6a4a30');
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, w, h * 0.2);
      box(ctx, w * 0.38, 0, w * 0.24, h * 0.62, 1, it.gold ? '#f8ecc0' : '#f2ead6', P.lux >= 4 ? P.gold : '#3a2a1e');
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(w * 0.48, h * 0.12, w * 0.04, h * 0.34);
      circ(ctx, w * 0.8, h * 0.55, u * 0.07, it.gold ? P.gold : '#3a5a8a');
      circ(ctx, w * 0.78, h * 0.45, u * 0.04, '#e86a8a'); circ(ctx, w * 0.85, h * 0.5, u * 0.035, '#f8f0e0');
      if (it.gold) { ctx.strokeStyle = P.gold; ctx.lineWidth = 1.5; ctx.strokeRect(0.5, 0.5, w - 1, h - 1); }
    });
  },
  dais(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(X + u * 0.05, Y + u * 0.08, W, H);
    box(ctx, X, Y, W, H, 2, it.gold ? '#7a1010' : P.woodDk);
    ctx.fillStyle = it.gold ? P.gold : '#a88a4a'; ctx.fillRect(X, Y + H - Math.max(2, u * 0.06), W, Math.max(2, u * 0.06));
    box(ctx, X + u * 0.08, Y + u * 0.06, W - u * 0.16, H - u * 0.2, 1, P.tatami, it.gold ? P.gold : '#2a3550', Math.max(1.5, u * 0.05));
    const cx = X + W / 2, cy = Y + H * 0.55;
    box(ctx, cx - u * 0.3, cy - u * 0.22, u * 0.6, u * 0.44, u * 0.06, it.gold ? '#c8141c' : '#8b2a24', it.gold ? P.gold : '#cfa83e', 1.5);
    if (it.gold) {
      box(ctx, cx - u * 0.25, cy - u * 0.3, u * 0.5, u * 0.08, 2, P.gold, '#7a4a12');
      ctx.fillStyle = '#fff1a8';
      ctx.beginPath(); ctx.moveTo(cx + u * 0.48, cy + u * 0.12); ctx.arc(cx + u * 0.48, cy + u * 0.12, u * 0.18, -2.6, -0.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1; ctx.stroke();
    }
    addLight(g, cx, cy, u * (it.gold ? 1.8 : 1.2), it.gold ? 'rgba(255,215,90,A)' : 'rgba(255,200,120,A)', it.gold ? 0.5 : 0.3);
  },
  urn(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    circ(ctx, cx + u * 0.03, cy + u * 0.05, u * 0.13, 'rgba(0,0,0,0.25)');
    circ(ctx, cx, cy, u * 0.13, it.c || '#f0ece0', P.lux >= 5 ? P.gold : '#2a3a6a', 1.5);
    circ(ctx, cx, cy, u * 0.05, it.c2 || '#2a4a8a');
  },
  shachi(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    box(ctx, cx - u * 0.2, cy - u * 0.14, u * 0.4, u * 0.28, 2, '#1e120c', P.gold);
    ctx.fillStyle = P.gold;
    ctx.beginPath(); ctx.moveTo(cx - u * 0.14, cy + u * 0.04);
    ctx.quadraticCurveTo(cx, cy - u * 0.16, cx + u * 0.12, cy - u * 0.02);
    ctx.lineTo(cx + u * 0.16, cy - u * 0.12); ctx.lineTo(cx + u * 0.08, cy + u * 0.06); ctx.closePath(); ctx.fill();
    circ(ctx, cx - u * 0.06, cy - u * 0.02, u * 0.02, '#1e120c');
    addLight(g, cx, cy, u * 0.6, 'rgba(255,215,90,A)', 0.35);
  },
  teaset(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    box(ctx, cx - u * 0.18, cy - u * 0.18, u * 0.36, u * 0.36, 2, '#2a2420');
    circ(ctx, cx, cy, u * 0.12, it.gold ? P.gold : '#3a3a3a', '#111');
    circ(ctx, cx, cy, u * 0.04, '#111');
    circ(ctx, cx + u * 0.32, cy, u * 0.07, '#5a7a4a', 'rgba(0,0,0,0.3)');
    circ(ctx, cx + u * 0.32, cy, u * 0.04, '#8ac06a');
    box(ctx, cx - u * 0.4, cy - u * 0.06, u * 0.12, u * 0.12, 1, it.gold ? P.gold : '#6a4a2a');
  },
  pillar(g, it) {
    const { ctx, u, P } = g;
    const cx = g.rx + it.x * u, cy = g.ry + it.y * u;
    const s = u * (it.s || 0.2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(cx - s / 2 + u * 0.04, cy - s / 2 + u * 0.05, s, s);
    box(ctx, cx - s / 2, cy - s / 2, s, s, 1, it.c || P.wood, P.gold, 1.2);
    ctx.fillStyle = P.gold; ctx.fillRect(cx - s / 2, cy - s / 2, s, s * 0.18);
  },
  banner(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    box(ctx, X, Y, W, H, 1, it.c || P.fab2, P.gold, 1);
    const m = Math.min(W, H) * 0.3, cx = X + W / 2, cy = Y + H / 2;
    ctx.fillStyle = '#f4ead0';
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * m * 0.15, cy + dy * m * 0.15);
      ctx.lineTo(cx + dx * m + dy * m * 0.4, cy + dy * m - dx * m * 0.4);
      ctx.lineTo(cx + dx * m - dy * m * 0.4, cy + dy * m + dx * m * 0.4); ctx.closePath(); ctx.fill();
    }
  },
  goldbars(g, it) {
    const { ctx, u, P } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(X + u * 0.04, Y + u * 0.06, W, H);
    box(ctx, X, Y, W, H, 2, '#1e120c', P.gold, 1.2);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        const bx = X + W * 0.1 + i * W * 0.28, by = Y + H * 0.15 + j * H * 0.4;
        ctx.beginPath(); ctx.ellipse(bx + W * 0.11, by + H * 0.15, W * 0.11, H * 0.15, 0, 0, Math.PI * 2);
        ctx.fillStyle = (i + j) % 2 ? '#ffe27a' : '#f4c842'; ctx.fill();
        ctx.strokeStyle = '#a07010'; ctx.lineWidth = 0.8; ctx.stroke();
      }
    }
    addLight(g, X + W / 2, Y + H / 2, u * 0.8, 'rgba(255,215,90,A)', 0.35);
  },
  wallband(g, it) {
    const { ctx, u } = g;
    const X = g.rx + it.x * u, Y = g.ry + it.y * u, W = it.w * u, H = it.h * u;
    ctx.fillStyle = it.c; ctx.fillRect(X, Y, W, H);
    if (it.pat === 'gold') { ctx.fillStyle = 'rgba(255,255,230,0.45)'; for (let xx = X; xx < X + W; xx += u * 0.25) ctx.fillRect(xx, Y, 1, H); for (let yy = Y; yy < Y + H; yy += u * 0.25) ctx.fillRect(X, yy, W, 1); }
  },
};

/* ---------------- room programs ----------------
 * Room order A,B,C (top row) D,E,F (bottom). Coords 0..3 inside each room.
 * Top rooms: back wall = top. Doors bottom-mid + side-mid (B both, A right, C left).
 * Bottom rooms: back wall = bottom. Doors top-mid + side-mid (E both, D right, F left).
 * Stairs: C top-right cell (1F,2F); D bottom-left cell (2F,3F). Spawn: E bottom-mid (1F).
 */
const when = (c, arr) => (c ? arr : []);

function floor1(skin, P) {
  const L = P.lux, jp = P.jp, gold = skin === 'osaka';
  const R = [];
  // A: kitchen
  R.push(jp ? { floor: gold ? 'lacquer' : 'stone', name: '台所', items: [
    { t: 'kamado', x: 0.12, y: 0.08, w: 1.3, h: 0.55, n: 2 },
    { t: 'counter', x: 1.55, y: 0.08, w: 1.35, h: 0.5, stove: false, top: '#8a6a4a', body: P.woodDk },
    { t: 'shelf', x: 0.06, y: 0.95, w: 0.38, h: 1.2, f: 'r', c: P.woodDk },
    { t: 'urn', x: 0.35, y: 2.6, c: '#5a4030', c2: '#2a1a10' },
    { t: 'urn', x: 0.75, y: 2.72, c: '#7a5a3a', c2: '#3a2a1a' },
    { t: 'lowtable', x: 1.15, y: 1.25, w: 0.7, h: 0.42, n: 2, c: P.woodDk, zc: P.fab },
    { t: 'andon', x: 2.65, y: 2.65 },
    ...when(gold, [{ t: 'wallband', x: 0, y: 0, w: 3, h: 0.06, c: P.gold }, { t: 'shachi', x: 2.6, y: 0.95 }]),
  ] } : { floor: L >= 4 ? 'marble' : L >= 2 ? 'checker' : L === 1 ? 'terracotta' : 'tile', name: 'キッチン', items: [
    ...when(L >= 1, [{ t: 'rug', x: 0.6, y: 0.68, w: 1.5, h: 0.32, pat: 'stripe', c: P.fab2, b: P.fab, flat: true }]),
    { t: 'counter', x: 0.08, y: 0.08, w: 2.2, h: 0.5, pot: L >= 1 },
    { t: 'fridge', x: 2.35, y: 0.08, w: 0.55, h: 0.55 },
    ...when(L >= 1, [{ t: 'counter', x: 0.08, y: 0.7, w: 0.48, h: 1.3, f: 'r', stove: false, sink: false }]),
    ...(L >= 3 ? [{ t: 'table', x: 1.0, y: 1.35, w: 1.4, h: 0.45, chairs: 3, noTop: true, c: '#f2eee8', cc: '#3a3d42', plain: true }]
      : [{ t: 'table', x: 1.1, y: 1.3, w: 0.8, h: 0.5, chairs: 2, plain: true, c: P.woodLt }]),
    ...when(L >= 1, [{ t: 'plant', x: 2.68, y: 2.65, r: 0.2 }]),
    { t: L >= 2 ? 'chandelier' : 'pendant', x: 1.6, y: 1.55, r: 0.26, arms: 5 },
  ] });
  // B: living / hall
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '広間', items: [
    { t: 'tokonoma', x: 0.6, y: 0.04, w: 1.8, h: 0.45, gold },
    ...when(gold, [{ t: 'byobu', x: 2.35, y: 0.06, w: 0.6, h: 0.32, n: 2, gold }, { t: 'pillar', x: 0.12, y: 0.12, c: '#a01c1c' }, { t: 'pillar', x: 2.88, y: 2.88, c: '#a01c1c' }, { t: 'pillar', x: 0.12, y: 2.88, c: '#a01c1c' }]),
    ...when(gold, [{ t: 'rug', x: 0.55, y: 0.7, w: 1.9, h: 1.65, pat: 'red', c: '#a3121a', b: P.gold, flat: true }]),
    { t: 'lowtable', x: 1.1, y: 1.15, w: 0.8, h: 0.55, c: gold ? '#1e120c' : P.woodDk, zc: gold ? '#f4c842' : P.fab },
    { t: 'andon', x: 0.32, y: 2.35 }, { t: 'andon', x: 2.68, y: 2.35 },
    { t: 'bonsai', x: 0.4, y: 0.78 },
  ] } : { floor: L >= 4 ? 'marble' : L >= 2 ? 'parquet' : 'plank', name: 'リビング', items: [
    { t: 'rug', x: 0.5, y: 0.75, w: 2.0, h: 1.55, pat: L >= 2 ? 'persian' : L === 1 ? 'quilt' : 'border', c: L >= 4 ? '#e6dfd2' : P.rug, flat: true },
    ...(L >= 2 ? [{ t: 'fireplace', x: 0.9, y: 0.04, w: 1.2, h: 0.45, c: L >= 4 ? '#f2eee8' : '#d8cfc0' }] : [{ t: 'tv', x: 0.8, y: 0.06, w: 1.4, h: 0.35 }]),
    { t: 'sofa', x: 0.7, y: 1.85, w: 1.6, h: 0.55, f: 'u', L: L >= 4, c: L >= 4 ? '#ece4d4' : P.fab },
    { t: 'table', x: 1.1, y: 1.05, w: 0.8, h: 0.45, plain: L < 2, c: L >= 4 ? '#f2eee8' : P.woodLt, vase: L >= 1 ? '#f0ece6' : null },
    ...when(L >= 1, [{ t: 'armchair', x: 0.08, y: 0.55, w: 0.5, h: 0.55, f: 'r', c: P.fab2 }]),
    ...when(L >= 2, [{ t: 'armchair', x: 2.42, y: 0.55, w: 0.5, h: 0.55, f: 'l', c: P.fab2 }]),
    { t: 'plant', x: 0.3, y: 0.3, r: L >= 3 ? 0.26 : 0.2, palm: L >= 3 },
    ...when(L >= 1, [{ t: 'lamp', x: 2.7, y: 0.3 }]),
    ...when(L >= 4, [{ t: 'art', x: 0.1, y: 2.86, w: 0.6, h: 0.12, spot: true }, { t: 'plant', x: 2.7, y: 2.7, palm: true }]),
    ...(L >= 2 ? [{ t: 'chandelier', x: 1.5, y: 1.3, r: 0.42, arms: L >= 4 ? 8 : 6 }] : [{ t: 'pendant', x: 1.5, y: 1.3 }]),
  ] });
  // C: dining (stairs top-right)
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '膳の間', items: [
    ...when(gold, [{ t: 'rug', x: 0.3, y: 0.8, w: 2.3, h: 1.4, pat: 'red', c: '#a3121a', b: P.gold, flat: true }]),
    { t: 'byobu', x: 0.1, y: 0.06, w: 1.7, h: 0.36, n: 6, gold: L >= 4 },
    { t: 'lowtable', x: 0.75, y: 1.25, w: 1.4, h: 0.5, n: 4, c: gold ? '#1e120c' : P.woodDk, zc: gold ? '#b3151b' : P.fab2 },
    { t: 'andon', x: 2.65, y: 2.65 },
    { t: 'urn', x: 0.32, y: 2.65 },
    ...when(gold, [{ t: 'wallband', x: 0, y: 2.94, w: 3, h: 0.06, c: P.gold }]),
  ] } : { floor: L >= 4 ? 'marble' : L >= 2 ? 'parquet' : 'plank', name: 'ダイニング', items: [
    ...when(L >= 1, [{ t: 'rug', x: 0.3, y: 0.8, w: 2.4, h: 1.55, pat: L >= 2 ? 'persian' : 'border', c: L >= 4 ? '#e9e2d6' : P.rug, flat: true }]),
    ...(L >= 2 ? [{ t: 'wardrobe', x: 0.1, y: 0.06, w: 1.5, h: 0.4, c: P.woodDk }] : [{ t: 'shelf', x: 0.1, y: 0.06, w: 1.0, h: 0.35 }]),
    { t: 'table', x: L >= 2 ? 0.6 : 0.85, y: 1.3, w: L >= 2 ? 1.8 : 1.3, h: 0.6, chairs: L >= 2 ? 6 : 4, ends: L >= 3, set: L >= 1, candle: L >= 2, cloth: L >= 2 ? '#f4efe4' : null, cush: L >= 2 ? P.fab : null },
    ...when(L >= 1, [{ t: 'plant', x: 0.3, y: 2.7 }]),
    ...when(L >= 3, [{ t: 'art', x: 2.86, y: 1.0, w: 0.12, h: 0.9, spot: true }]),
    { t: L >= 2 ? 'chandelier' : 'pendant', x: 1.5, y: 1.6, r: 0.38, arms: 8 },
  ] });
  // D: bath + toilet
  R.push({ floor: gold ? 'marbleDark' : jp ? 'stone' : L >= 4 ? 'marble' : L >= 2 ? 'checker' : 'tile', name: '浴室', items: [
    { t: 'rug', x: 1.55, y: 1.9, w: 0.6, h: 0.4, pat: 'mat', c: jp ? '#c9b47a' : '#bcd8e4', b: '#ffffff', flat: true },
    { t: 'tub', x: 0.08, y: 1.72, w: 1.4, h: 1.2, f: 'u', hinoki: jp },
    { t: 'sink', x: 0.08, y: 0.85, w: 0.5, h: 0.6, f: 'r' },
    { t: 'toilet', x: 2.4, y: 2.35, w: 0.5, h: 0.55, f: 'u' },
    ...when(!jp, [{ t: 'washer', x: 2.42, y: 0.4, w: 0.5, h: 0.5, f: 'l' }]),
    ...when(L >= 3, [{ t: 'plant', x: 0.32, y: 0.32 }]),
    ...when(gold, [{ t: 'wallband', x: 0, y: 2.94, w: 3, h: 0.06, c: P.gold }]),
  ] });
  // E: entrance (spawn bottom-mid)
  R.push({ floor: jp ? (gold ? 'lacquer' : 'stone') : L >= 4 ? 'marbleDark' : L >= 2 ? 'checker' : 'stone', name: '玄関', items: [
    { t: 'rug', x: 0.85, y: 2.15, w: 1.3, h: 0.72, pat: jp ? 'red' : 'mat', c: jp ? '#a3121a' : P.fab2, b: jp ? P.gold : P.fab, flat: true },
    { t: 'shoebox', x: 0.08, y: 2.5, w: 0.75, h: 0.42, f: 'u', c: jp ? P.woodDk : P.woodLt },
    { t: 'shoes', x: 1.0, y: 2.55, n: 1 },
    ...(jp ? [{ t: 'armor', x: 2.3, y: 0.08, w: 0.62, h: 0.7 }, { t: 'katana', x: 2.15, y: 2.48, w: 0.75, h: 0.45, f: 'u' }]
      : [{ t: 'coatrack', x: 2.62, y: 2.25 }, { t: 'umbrella', x: 2.68, y: 2.75 }]),
    ...when(L >= 2 && !jp, [{ t: 'table', x: 2.25, y: 0.1, w: 0.65, h: 0.4, vase: '#f0ece6' }]),
    ...when(L >= 4 && !jp, [{ t: 'statue', x: 0.35, y: 0.4 }]),
    ...when(L < 2, [{ t: 'plant', x: 0.35, y: 0.4, r: 0.18 }]),
    ...(L >= 2 ? [{ t: jp ? 'andon' : 'chandelier', x: 1.5, y: 1.15, r: 0.3 }] : [{ t: 'pendant', x: 1.5, y: 1.2 }]),
    ...when(gold, [{ t: 'shachi', x: 0.32, y: 0.38 }, { t: 'pillar', x: 0.88, y: 0.12, c: '#a01c1c' }, { t: 'pillar', x: 2.12, y: 0.12, c: '#a01c1c' }]),
  ] });
  // F: per-skin signature room
  const F = {
    basic: { floor: 'plank', name: '物置', items: [
      { t: 'crate', x: 2.3, y: 2.3, w: 0.6, h: 0.6 }, { t: 'crate', x: 1.6, y: 2.45, w: 0.55, h: 0.45 },
      { t: 'shelf', x: 2.55, y: 0.25, w: 0.35, h: 1.0, f: 'l', c: P.wood }, { t: 'pendant', x: 1.5, y: 1.4 }] },
    cottage: { floor: 'plank', name: 'パントリー', items: [
      { t: 'rug', x: 0.85, y: 1.1, w: 1.3, h: 0.95, pat: 'quilt', flat: true },
      { t: 'shelf', x: 0.9, y: 2.55, w: 2.0, h: 0.38, f: 'u', c: P.woodLt },
      { t: 'counter', x: 2.45, y: 0.15, w: 0.45, h: 1.0, f: 'l', sink: false, stove: false, top: '#d9b07a' },
      { t: 'crate', x: 0.15, y: 0.2, w: 0.45, h: 0.4 }, { t: 'urn', x: 0.85, y: 0.35, c: '#c9a26a', c2: '#8a5a2a' },
      { t: 'plant', x: 0.4, y: 2.6 }, { t: 'pendant', x: 1.5, y: 1.5 }] },
    mansion: { floor: 'parquet', name: '音楽室', items: [
      { t: 'rug', x: 0.5, y: 0.4, w: 2.0, h: 1.9, pat: 'persian', flat: true },
      { t: 'piano', x: 1.55, y: 0.6, w: 1.3, h: 1.1 },
      { t: 'chair', x: 1.15, y: 1.0, w: 0.32, h: 0.32, f: 'l', cush: P.fab },
      { t: 'shelf', x: 0.9, y: 2.55, w: 1.7, h: 0.38, f: 'u' },
      { t: 'plant', x: 2.7, y: 2.62 }, { t: 'lamp', x: 0.3, y: 0.32 }, { t: 'chandelier', x: 1.5, y: 1.5, r: 0.3 }] },
    villa: { floor: 'marbleDark', name: 'バー', items: [
      { t: 'bar', x: 0.85, y: 2.0, w: 2.08, h: 0.95, f: 'u' },
      { t: 'sofa', x: 2.42, y: 0.15, w: 1.1, h: 0.5, f: 'l', c: '#3a3d42', pc: P.gold },
      { t: 'table', x: 1.25, y: 1.0, w: 0.62, h: 0.62, round: true, c: '#f2eee8' },
      { t: 'plant', x: 0.95, y: 0.35, palm: true, r: 0.24 }, { t: 'pendant', x: 1.75, y: 0.8, r: 0.9 }] },
    castle_keep: { floor: 'plankDark', name: '武具蔵', items: [
      { t: 'armor', x: 2.35, y: 0.25, w: 0.6, h: 0.7, f: 'l' }, { t: 'armor', x: 2.35, y: 1.15, w: 0.6, h: 0.7, f: 'l', c: '#5a1a14' },
      { t: 'katana', x: 0.9, y: 2.45, w: 1.3, h: 0.45, f: 'u' },
      { t: 'banner', x: 2.25, y: 2.4, w: 0.65, h: 0.5, c: P.fab },
      { t: 'andon', x: 1.3, y: 1.3 }] },
    osaka: { floor: 'tatamiGold', name: '茶室', items: [
      { t: 'fusuma', x: 0.9, y: 2.8, w: 2.08, h: 0.18, f: 'u', n: 4, gold: true },
      { t: 'fusuma', x: 2.8, y: 0.25, w: 0.18, h: 1.0, f: 'l', n: 2, gold: true },
      { t: 'byobu', x: 0.9, y: 2.3, w: 1.5, h: 0.4, f: 'u', n: 4, gold: true },
      { t: 'teaset', x: 1.35, y: 1.1, gold: true },
      { t: 'tokonoma', x: 1.1, y: 0.04, w: 1.3, h: 0.36, gold: true },
      { t: 'andon', x: 2.55, y: 1.9 }] },
  };
  R.push(F[skin] || F.basic);
  return R;
}

function floor2(skin, P) {
  const L = P.lux, jp = P.jp, gold = skin === 'osaka';
  const R = [];
  // A: master bedroom
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '寝所', items: [
    { t: 'futon', x: 0.35, y: 0.15, w: 0.95, h: 1.65, c: gold ? '#b3151b' : P.fab, gold: L >= 4 },
    { t: 'futon', x: 1.45, y: 0.15, w: 0.95, h: 1.65, c: gold ? '#1e2a5a' : '#6a4a6a', gold: L >= 4 },
    { t: 'byobu', x: 0.08, y: 2.25, w: 1.2, h: 0.4, n: 4, gold: L >= 4, f: 'u' },
    { t: 'andon', x: 2.7, y: 0.32 }, { t: 'andon', x: 2.68, y: 2.68 },
    ...when(gold, [{ t: 'wallband', x: 0, y: 0, w: 3, h: 0.08, c: '#e8bf3c', pat: 'gold' }]),
  ] } : { floor: L >= 2 ? 'carpet' : 'plank', name: '主寝室', items: [
    { t: 'rug', x: 0.45, y: 0.95, w: 2.1, h: 1.45, pat: L >= 2 ? 'persian' : L === 1 ? 'quilt' : 'border', flat: true, c: L >= 4 ? '#d8cbb4' : P.rug },
    { t: 'bed', x: 0.85, y: 0.06, w: 1.3, h: 1.7, c: L >= 4 ? '#ece4d4' : P.fab, canopy: L >= 3, pat: L === 1 ? 'check' : null },
    { t: 'night', x: 0.36, y: 0.08, w: 0.42, h: 0.38 }, { t: 'night', x: 2.22, y: 0.08, w: 0.42, h: 0.38 },
    ...when(L >= 1, [{ t: 'dresser', x: 0.06, y: 1.0, w: 0.36, h: 0.8, f: 'r' }]),
    ...when(L >= 2, [{ t: 'armchair', x: 0.12, y: 2.32, w: 0.55, h: 0.55, f: 'u', c: P.fab2 }]),
    ...when(L >= 1, [{ t: 'plant', x: 2.7, y: 2.68 }]),
    ...when(L >= 3, [{ t: 'chandelier', x: 1.5, y: 1.95, r: 0.28 }]),
  ] });
  // B: study
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '書院', items: [
    ...when(gold, [{ t: 'rug', x: 0.7, y: 0.75, w: 1.6, h: 1.4, pat: 'red', c: '#a3121a', b: P.gold, flat: true }]),
    { t: 'tokonoma', x: 0.1, y: 0.04, w: 1.3, h: 0.45, gold },
    { t: 'shelf', x: 1.6, y: 0.06, w: 1.3, h: 0.36, c: P.woodDk },
    { t: 'lowtable', x: 1.1, y: 1.15, w: 0.8, h: 0.45, n: 1, c: gold ? '#1e120c' : P.woodDk, zc: gold ? '#b3151b' : P.fab },
    { t: 'andon', x: 2.35, y: 1.0 },
    { t: 'bonsai', x: 0.4, y: 2.6 },
    ...when(gold, [{ t: 'byobu', x: 1.95, y: 2.55, w: 0.95, h: 0.35, n: 3, gold, f: 'u' }]),
  ] } : { floor: L >= 2 ? 'parquet' : 'plank', name: '書斎', items: [
    { t: 'rug', x: 0.65, y: 0.8, w: 1.7, h: 1.2, pat: L >= 2 ? 'persian' : 'stripe', flat: true, c: L >= 2 ? P.fab2 : P.rug },
    { t: 'shelf', x: 0.08, y: 0.06, w: 1.2, h: 0.36 }, { t: 'shelf', x: 1.72, y: 0.06, w: 1.2, h: 0.36 },
    ...when(L >= 2, [{ t: 'shelf', x: 0.06, y: 0.5, w: 0.36, h: 0.65, f: 'r' }]),
    { t: 'desk', x: 0.95, y: 0.95, w: 1.1, h: 0.75, pc: L >= 3, c: P.woodDk },
    ...(L >= 2 ? [{ t: 'globe', x: 2.65, y: 2.6 }, { t: 'armchair', x: 2.42, y: 0.5, w: 0.5, h: 0.5, f: 'l', c: P.fab }] : [{ t: 'plant', x: 2.65, y: 2.6 }]),
    ...when(L >= 4, [{ t: 'plant', x: 0.35, y: 2.6, palm: true }]),
  ] });
  // C: kids room (stairs top-right)
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '若君の間', items: [
    { t: 'futon', x: 0.15, y: 0.12, w: 0.9, h: 1.05, c: gold ? '#e8a0b8' : '#c87a5a', gold },
    { t: 'toys', x: 1.3, y: 1.25 },
    { t: 'banner', x: 1.2, y: 0.05, w: 0.6, h: 0.35, c: gold ? '#b3151b' : P.fab },
    { t: 'andon', x: 0.38, y: 2.62 },
    { t: 'wardrobe', x: 2.55, y: 1.1, w: 0.36, h: 0.9, f: 'l', c: P.woodDk },
  ] } : { floor: 'plank', name: '子ども部屋', items: [
    { t: 'rug', x: 0.85, y: 0.95, w: 1.35, h: 1.25, round: true, c: '#8ac8e8', b: '#f2d24a', flat: true },
    { t: 'bed', x: 0.08, y: 0.06, w: 0.75, h: 1.1, c: L >= 2 ? '#e88aa8' : '#f2b24a', pat: L === 1 ? 'check' : null },
    { t: 'toys', x: 1.25, y: 1.3 },
    { t: 'desk', x: 0.95, y: 0.06, w: 0.85, h: 0.6, c: P.woodLt, cc: '#e84a4a' },
    { t: 'wardrobe', x: 2.55, y: 1.1, w: 0.36, h: 0.9, f: 'l', c: P.woodLt },
    ...when(L >= 1, [{ t: 'plant', x: 0.35, y: 2.65 }]),
    ...when(L >= 3, [{ t: 'telescope', x: 2.5, y: 2.5 }]),
  ] });
  // D: closet / dressing (stairs bottom-left)
  R.push(jp ? { floor: gold ? 'lacquer' : 'plankDark', name: '納戸', items: [
    { t: 'wardrobe', x: 0.06, y: 0.15, w: 0.4, h: 1.6, f: 'r', c: P.woodDk },
    { t: 'wardrobe', x: 1.0, y: 2.55, w: 1.9, h: 0.4, f: 'u', c: gold ? '#7a1010' : P.wood },
    { t: 'armor', x: 2.28, y: 0.1, w: 0.62, h: 0.65, c: gold ? '#3a1010' : '#1e2430' },
    { t: 'urn', x: 1.5, y: 1.5 },
    ...when(gold, [{ t: 'goldbars', x: 2.3, y: 1.8, w: 0.6, h: 0.5 }]),
  ] } : { floor: L >= 2 ? 'carpet' : 'plank', name: 'クローゼット', items: [
    ...when(L >= 2, [{ t: 'rug', x: 0.9, y: 0.85, w: 1.4, h: 1.2, round: true, flat: true, c: P.fab2 }]),
    { t: 'wardrobe', x: 0.06, y: 0.15, w: 0.4, h: 1.6, f: 'r' },
    { t: 'wardrobe', x: 1.0, y: 2.55, w: 1.9, h: 0.4, f: 'u' },
    { t: 'dresser', x: 2.2, y: 0.08, w: 0.7, h: 0.4 },
    ...(L >= 3 ? [{ t: 'chandelier', x: 1.6, y: 1.45, r: 0.26 }, { t: 'armchair', x: 1.35, y: 1.2, w: 0.5, h: 0.45, c: P.fab }] : [{ t: 'crate', x: 1.4, y: 1.3, w: 0.45, h: 0.4 }]),
  ] });
  // E: family hall
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '次の間', items: [
    ...when(gold, [{ t: 'rug', x: 0.5, y: 0.75, w: 2.0, h: 1.65, pat: 'red', c: '#a3121a', b: P.gold, flat: true }]),
    { t: 'fusuma', x: 0.1, y: 2.8, w: 2.8, h: 0.18, f: 'u', n: 6, gold: L >= 4 },
    { t: 'lowtable', x: 1.1, y: 1.3, w: 0.8, h: 0.5, n: 4, c: gold ? '#7a1010' : P.woodDk, zc: gold ? '#1e2a5a' : P.fab2 },
    { t: 'andon', x: 0.32, y: 0.4 }, { t: 'andon', x: 2.68, y: 0.4 },
    ...when(gold, [{ t: 'urn', x: 2.6, y: 2.4, c: '#f4c842', c2: '#b3151b' }, { t: 'urn', x: 0.4, y: 2.4, c: '#f4c842', c2: '#1e2a5a' }]),
  ] } : { floor: L >= 4 ? 'marble' : L >= 2 ? 'parquet' : 'plank', name: 'ホール', items: [
    { t: 'rug', x: 0.6, y: 1.0, w: 1.8, h: 1.25, pat: L >= 2 ? 'persian' : 'stripe', flat: true, c: L >= 4 ? '#e6dfd2' : P.fab },
    { t: 'sofa', x: 0.75, y: 2.4, w: 1.5, h: 0.52, f: 'u', c: L >= 4 ? '#3a3d42' : P.fab2 },
    { t: 'table', x: 1.15, y: 1.45, w: 0.7, h: 0.45, round: L >= 3, plain: L < 2, c: L >= 4 ? '#f2eee8' : P.woodLt },
    { t: 'plant', x: 0.32, y: 0.4, palm: L >= 3 }, { t: 'plant', x: 2.68, y: 0.4, palm: L >= 3 },
    ...when(L >= 1, [{ t: 'lamp', x: 0.3, y: 2.65 }]),
    ...when(L >= 3, [{ t: 'art', x: 2.35, y: 2.86, w: 0.55, h: 0.12, spot: true }]),
    { t: L >= 2 ? 'chandelier' : 'pendant', x: 1.5, y: 1.55, r: 0.34 },
  ] });
  // F: guest bedroom
  R.push(jp ? { floor: gold ? 'tatamiGold' : 'tatami', name: '客間', items: [
    { t: 'futon', x: 0.8, y: 1.25, w: 1.0, h: 1.6, f: 'u', c: gold ? '#b3151b' : '#4a6a5a', gold },
    { t: 'tokonoma', x: 2.52, y: 1.2, w: 1.6, h: 0.42, f: 'l', gold },
    { t: 'andon', x: 0.32, y: 2.68 },
    { t: 'bonsai', x: 2.4, y: 0.45 },
  ] } : { floor: L >= 2 ? 'carpet' : 'plank', name: '客間', items: [
    { t: 'rug', x: 0.5, y: 0.9, w: 1.9, h: 1.5, pat: L >= 2 ? 'persian' : 'border', flat: true, c: L >= 4 ? '#e9e2d6' : P.fab3 },
    { t: 'bed', x: 0.8, y: 1.25, w: 1.05, h: 1.67, f: 'u', c: L >= 4 ? '#3a3d42' : P.fab3 },
    { t: 'night', x: 1.95, y: 2.52, w: 0.4, h: 0.38, f: 'u' },
    { t: 'wardrobe', x: 2.55, y: 0.25, w: 0.36, h: 1.0, f: 'l' },
    ...when(L >= 1, [{ t: 'plant', x: 0.35, y: 0.4 }]),
    ...when(L >= 3, [{ t: 'art', x: 2.86, y: 1.6, w: 0.12, h: 0.7 }]),
  ] });
  return R;
}

function floor3(skin, P) {
  const GB = (x, y, w, h) => ({ t: 'wallband', x, y, w, h, c: '#e8bf3c', pat: 'gold' });
  const S = {
    basic: [
      { floor: 'plank', name: '屋根裏', items: [{ t: 'crate', x: 0.15, y: 0.15, w: 0.6, h: 0.55 }, { t: 'crate', x: 0.85, y: 0.2, w: 0.45, h: 0.45 }, { t: 'crate', x: 0.15, y: 0.8, w: 0.45, h: 0.4 }, { t: 'pendant', x: 1.5, y: 1.5 }] },
      { floor: 'plank', name: '趣味部屋', items: [{ t: 'rug', x: 0.8, y: 0.9, w: 1.4, h: 1.0, flat: true }, { t: 'easel', x: 1.2, y: 0.12, w: 0.6, h: 0.6 }, { t: 'chair', x: 1.3, y: 1.2, w: 0.4, h: 0.4 }] },
      { floor: 'plank', name: '物干し', items: [{ t: 'crate', x: 2.3, y: 0.2, w: 0.5, h: 0.5 }, { t: 'plant', x: 0.4, y: 2.6 }] },
      { floor: 'plank', name: '屋根裏', items: [{ t: 'shelf', x: 2.55, y: 0.15, w: 0.35, h: 1.0, f: 'l', c: P.wood }, { t: 'crate', x: 1.6, y: 2.4, w: 0.5, h: 0.45 }] },
      { floor: 'plank', name: '屋根裏', items: [{ t: 'futon', x: 0.2, y: 1.6, w: 1.1, h: 1.3, f: 'u', c: P.fab }, { t: 'lamp', x: 2.6, y: 2.6, r: 0.6 }] },
      { floor: 'plank', name: '屋根裏', items: [{ t: 'crate', x: 2.3, y: 2.3, w: 0.55, h: 0.55 }, { t: 'shelf', x: 0.9, y: 2.55, w: 1.2, h: 0.38, f: 'u', c: P.wood }] },
    ],
    cottage: [
      { floor: 'plank', name: '手芸部屋', items: [{ t: 'rug', x: 0.45, y: 0.75, w: 2.1, h: 1.45, pat: 'quilt', flat: true }, { t: 'shelf', x: 0.1, y: 0.06, w: 1.6, h: 0.36, c: P.woodLt }, { t: 'table', x: 0.9, y: 1.2, w: 1.1, h: 0.5, chairs: 2, noTop: true, c: P.woodLt, plain: true }, { t: 'plant', x: 2.6, y: 0.35 }, { t: 'pendant', x: 1.5, y: 1.4 }] },
      { floor: 'plank', name: '読書ロフト', items: [{ t: 'rug', x: 0.6, y: 0.85, w: 1.8, h: 1.3, round: true, flat: true, c: P.fab, b: P.fab2 }, { t: 'shelf', x: 0.1, y: 0.06, w: 2.8, h: 0.36 }, { t: 'armchair', x: 0.8, y: 1.05, w: 0.6, h: 0.6, c: P.fab3 }, { t: 'lamp', x: 1.75, y: 1.15 }, { t: 'plant', x: 2.7, y: 2.6 }] },
      { floor: 'plank', name: 'アトリエ', items: [{ t: 'rug', x: 0.9, y: 1.0, w: 1.2, h: 0.9, pat: 'stripe', flat: true }, { t: 'easel', x: 0.35, y: 0.25, w: 0.6, h: 0.6 }, { t: 'crate', x: 2.3, y: 2.3, w: 0.55, h: 0.5 }, { t: 'plant', x: 2.6, y: 0.4 }] },
      { floor: 'plank', name: '屋根裏寝室', items: [{ t: 'bed', x: 1.0, y: 1.25, w: 1.0, h: 1.67, f: 'u', c: P.fab, pat: 'check' }, { t: 'night', x: 2.1, y: 2.52, w: 0.4, h: 0.38, f: 'u' }, { t: 'plant', x: 2.6, y: 0.4 }] },
      { floor: 'plank', name: 'くつろぎ', items: [{ t: 'rug', x: 0.8, y: 1.15, w: 1.4, h: 1.0, pat: 'quilt', flat: true }, { t: 'sofa', x: 0.8, y: 2.4, w: 1.4, h: 0.5, f: 'u', c: P.fab }, { t: 'lamp', x: 0.35, y: 0.4 }, { t: 'plant', x: 2.65, y: 0.4 }] },
      { floor: 'plank', name: '物置', items: [{ t: 'shelf', x: 0.9, y: 2.55, w: 2.0, h: 0.38, f: 'u', c: P.woodLt }, { t: 'crate', x: 2.3, y: 0.3, w: 0.55, h: 0.5 }, { t: 'urn', x: 0.4, y: 0.4, c: '#c9a26a', c2: '#8a5a2a' }] },
    ],
    mansion: [
      { floor: 'parquet', name: '図書室', items: [{ t: 'rug', x: 0.65, y: 0.8, w: 1.9, h: 1.55, pat: 'persian', flat: true }, { t: 'shelf', x: 0.06, y: 0.06, w: 2.88, h: 0.38 }, { t: 'shelf', x: 0.06, y: 0.5, w: 0.38, h: 2.4, f: 'r' }, { t: 'table', x: 1.0, y: 1.25, w: 1.1, h: 0.5, chairs: 2, noTop: true, candle: true, cush: P.fab }, { t: 'globe', x: 2.6, y: 2.6 }, { t: 'chandelier', x: 1.55, y: 1.5, r: 0.3 }] },
      { floor: 'parquet', name: '遊戯室', items: [{ t: 'rug', x: 0.4, y: 0.6, w: 2.2, h: 1.6, flat: true, c: P.fab2 }, { t: 'shelf', x: 0.4, y: 0.06, w: 2.2, h: 0.36, c: P.woodDk }, { t: 'billiard', x: 0.75, y: 0.85, w: 1.5, h: 0.95 }, { t: 'chandelier', x: 1.5, y: 1.3, r: 0.26 }] },
      { floor: 'carpet', name: '画廊', items: [{ t: 'art', x: 0.15, y: 0.02, w: 0.7, h: 0.16, spot: true }, { t: 'art', x: 1.1, y: 0.02, w: 0.55, h: 0.16, spot: true, pal: ['#8a2a2a', '#e8c890', '#2a4a6a'] }, { t: 'art', x: 2.82, y: 0.6, w: 0.16, h: 0.9, spot: true, pal: ['#2a5a3a', '#d8d0a0', '#6a3a2a'] }, { t: 'statue', x: 1.5, y: 1.3 }, { t: 'armchair', x: 2.3, y: 2.3, w: 0.55, h: 0.55, f: 'u', c: P.fab }] },
      { floor: 'parquet', name: '喫煙室', items: [{ t: 'rug', x: 0.55, y: 0.75, w: 2.0, h: 1.55, pat: 'persian', flat: true }, { t: 'fireplace', x: 0.9, y: 2.55, w: 1.3, h: 0.42, f: 'u' }, { t: 'armchair', x: 0.75, y: 1.05, w: 0.6, h: 0.6, c: P.fab }, { t: 'armchair', x: 1.75, y: 1.05, w: 0.6, h: 0.6, c: P.fab }, { t: 'shelf', x: 2.55, y: 0.15, w: 0.36, h: 0.9, f: 'l' }] },
      { floor: 'parquet', name: '舞踏室', items: [{ t: 'rug', x: 0.3, y: 0.5, w: 2.4, h: 1.7, pat: 'persian', flat: true }, { t: 'piano', x: 2.0, y: 2.1, w: 0.9, h: 0.82, f: 'u' }, { t: 'plant', x: 0.35, y: 2.62 }, { t: 'chandelier', x: 1.5, y: 1.3, r: 0.45, arms: 8 }] },
      { floor: 'carpet', name: '客用寝室', items: [{ t: 'bed', x: 0.8, y: 1.25, w: 1.3, h: 1.67, f: 'u', c: P.fab, canopy: true }, { t: 'night', x: 2.2, y: 2.52, w: 0.42, h: 0.38, f: 'u' }, { t: 'dresser', x: 2.55, y: 0.2, w: 0.36, h: 0.8, f: 'l' }, { t: 'chandelier', x: 1.5, y: 1.0, r: 0.26 }] },
    ],
    villa: [
      { floor: 'deck', name: 'ルーフプール', items: [{ t: 'pool', x: 0.12, y: 0.12, w: 2.1, h: 1.35 }, { t: 'lounger', x: 0.15, y: 1.9, w: 0.48, h: 0.95 }, { t: 'lounger', x: 0.75, y: 1.9, w: 0.48, h: 0.95, c: '#e6c56a' }, { t: 'plant', x: 2.62, y: 0.38, palm: true, r: 0.3 }, { t: 'plant', x: 2.62, y: 2.62, palm: true, r: 0.28 }] },
      { floor: 'marble', name: 'ラウンジ', items: [{ t: 'rug', x: 0.4, y: 0.6, w: 2.2, h: 1.7, flat: true, c: '#e6dfd2', b: P.gold }, { t: 'sofa', x: 0.45, y: 0.08, w: 2.1, h: 0.6, L: true, c: '#3a3d42', pc: P.gold }, { t: 'table', x: 1.05, y: 1.1, w: 0.9, h: 0.6, round: true, c: '#f2eee8', vase: '#2aa3b2' }, { t: 'statue', x: 0.35, y: 2.62 }, { t: 'plant', x: 2.65, y: 2.62, palm: true }, { t: 'chandelier', x: 1.5, y: 1.4, r: 0.42, arms: 10 }] },
      { floor: 'marble', name: '展望室', items: [{ t: 'sofa', x: 0.85, y: 0.08, w: 1.5, h: 0.55, c: P.fab, pc: '#2aa3b2' }, { t: 'telescope', x: 0.42, y: 0.45 }, { t: 'table', x: 1.3, y: 1.05, w: 0.55, h: 0.55, round: true, c: '#f2eee8' }, { t: 'plant', x: 2.65, y: 2.65, palm: true }, { t: 'lamp', x: 2.65, y: 0.4 }] },
      { floor: 'marble', name: 'シアター', items: [{ t: 'rug', x: 0.6, y: 0.75, w: 2.0, h: 1.4, flat: true, c: '#3a3d42', b: P.gold }, { t: 'tv', x: 0.75, y: 2.6, w: 2.1, h: 0.35, f: 'u', c: '#1a1a1e' }, { t: 'sofa', x: 0.6, y: 0.85, w: 2.0, h: 0.62, c: '#3a3d42', pc: P.gold }, { t: 'lamp', x: 2.65, y: 1.95, r: 0.6 }] },
      { floor: 'marble', name: 'ギャラリー', items: [{ t: 'rug', x: 0.95, y: 1.55, w: 1.1, h: 0.9, flat: true, c: '#3a3d42', b: P.gold }, { t: 'art', x: 0.1, y: 2.84, w: 0.8, h: 0.14, spot: true }, { t: 'art', x: 2.1, y: 2.84, w: 0.8, h: 0.14, spot: true, pal: ['#e8b060', '#2aa3b2', '#e86a6a'] }, { t: 'statue', x: 0.55, y: 0.6 }, { t: 'statue', x: 2.45, y: 0.6, c: '#e6c56a' }, { t: 'chandelier', x: 1.5, y: 1.3, r: 0.32, arms: 8 }] },
      { floor: 'marble', name: 'スイート', items: [{ t: 'rug', x: 0.5, y: 0.9, w: 2.0, h: 1.5, flat: true, c: '#e9e2d6', b: P.gold, pat: 'persian' }, { t: 'bed', x: 0.75, y: 1.2, w: 1.5, h: 1.72, f: 'u', c: '#ece4d4', canopy: true }, { t: 'night', x: 0.25, y: 2.52, w: 0.42, h: 0.38, f: 'u' }, { t: 'night', x: 2.33, y: 2.52, w: 0.42, h: 0.38, f: 'u' }, { t: 'sofa', x: 2.42, y: 0.15, w: 0.9, h: 0.48, f: 'l', c: '#2aa3b2' }, { t: 'plant', x: 0.35, y: 0.4, palm: true }, { t: 'chandelier', x: 1.5, y: 0.75, r: 0.28 }] },
    ],
    castle_keep: [
      { floor: 'tatami', name: '武者溜', items: [{ t: 'armor', x: 0.12, y: 0.08, w: 0.6, h: 0.7 }, { t: 'armor', x: 0.9, y: 0.08, w: 0.6, h: 0.7, c: '#5a1a14' }, { t: 'katana', x: 1.7, y: 0.08, w: 1.2, h: 0.45 }, { t: 'banner', x: 0.06, y: 1.05, w: 0.2, h: 0.9, c: P.fab }, { t: 'andon', x: 0.4, y: 2.6 }, { t: 'andon', x: 2.6, y: 2.6 }] },
      { floor: 'tatami', name: '天守 上段の間', items: [{ t: 'dais', x: 0.45, y: 0.06, w: 2.1, h: 1.2 }, { t: 'byobu', x: 0.6, y: 0.04, w: 1.8, h: 0.3, n: 6, gold: true }, { t: 'banner', x: 0.08, y: 0.1, w: 0.3, h: 0.7, c: P.fab2 }, { t: 'banner', x: 2.62, y: 0.1, w: 0.3, h: 0.7, c: P.fab2 }, { t: 'andon', x: 0.4, y: 2.0 }, { t: 'andon', x: 2.6, y: 2.0 }, { t: 'armor', x: 0.1, y: 2.3, w: 0.55, h: 0.6, f: 'u' }, { t: 'armor', x: 2.35, y: 2.3, w: 0.55, h: 0.6, f: 'u' }] },
      { floor: 'plankDark', name: '物見', items: [{ t: 'telescope', x: 2.4, y: 0.5 }, { t: 'banner', x: 2.3, y: 2.35, w: 0.6, h: 0.5, c: P.fab }, { t: 'andon', x: 0.4, y: 0.4 }, { t: 'lowtable', x: 1.1, y: 1.2, w: 0.7, h: 0.4, n: 1 }] },
      { floor: 'tatami', name: '茶室', items: [{ t: 'tokonoma', x: 0.9, y: 2.55, w: 1.5, h: 0.42, f: 'u' }, { t: 'teaset', x: 1.4, y: 1.25 }, { t: 'byobu', x: 2.45, y: 0.15, w: 1.0, h: 0.4, f: 'l', n: 3 }, { t: 'andon', x: 0.4, y: 0.4 }] },
      { floor: 'tatami', name: '大広間', items: [{ t: 'fusuma', x: 0.1, y: 2.8, w: 2.8, h: 0.18, f: 'u', n: 6 }, { t: 'byobu', x: 0.5, y: 2.3, w: 2.0, h: 0.4, f: 'u', n: 6 }, { t: 'andon', x: 0.3, y: 0.4 }, { t: 'andon', x: 2.7, y: 0.4 }, { t: 'pillar', x: 1.5, y: 0.9, c: P.woodDk }] },
      { floor: 'tatami', name: '宝物庫', items: [{ t: 'urn', x: 2.6, y: 0.4 }, { t: 'urn', x: 2.6, y: 0.85, c: '#2a3a6a', c2: '#e8e0c8' }, { t: 'katana', x: 0.9, y: 2.45, w: 1.3, h: 0.45, f: 'u' }, { t: 'armor', x: 2.3, y: 1.95, w: 0.6, h: 0.7, f: 'u' }, { t: 'andon', x: 0.5, y: 0.5 }] },
    ],
    osaka: [
      { floor: 'tatamiGold', name: '黄金の茶室', items: [GB(0, 0, 3, 0.1), GB(0, 0, 0.1, 3), { t: 'byobu', x: 0.2, y: 0.14, w: 2.1, h: 0.38, n: 6, gold: true }, { t: 'teaset', x: 1.4, y: 1.25, gold: true }, { t: 'andon', x: 0.4, y: 2.6 }, { t: 'shachi', x: 2.55, y: 0.45 }, { t: 'pillar', x: 2.85, y: 2.85, c: '#a01c1c' }] },
      { floor: 'tatamiGold', name: '天守 黄金玉座', items: [
        GB(0, 0, 3, 0.1),
        { t: 'rug', x: 1.05, y: 1.15, w: 0.9, h: 1.85, pat: 'red', c: '#b3151b', b: P.gold, flat: true },
        { t: 'dais', x: 0.35, y: 0.08, w: 2.3, h: 1.25, gold: true },
        { t: 'byobu', x: 0.4, y: 0.02, w: 2.2, h: 0.42, n: 6, gold: true },
        { t: 'pillar', x: 0.15, y: 0.15, c: '#a01c1c', s: 0.24 }, { t: 'pillar', x: 2.85, y: 0.15, c: '#a01c1c', s: 0.24 },
        { t: 'pillar', x: 0.15, y: 2.85, c: '#a01c1c', s: 0.24 }, { t: 'pillar', x: 2.85, y: 2.85, c: '#a01c1c', s: 0.24 },
        { t: 'shachi', x: 0.45, y: 1.75 }, { t: 'shachi', x: 2.55, y: 1.75 },
        { t: 'andon', x: 0.5, y: 2.5 }, { t: 'andon', x: 2.5, y: 2.5 }] },
      { floor: 'lacquer', name: '望楼', items: [GB(2.9, 0, 0.1, 3), { t: 'telescope', x: 2.3, y: 0.5 }, { t: 'banner', x: 2.2, y: 2.3, w: 0.6, h: 0.55, c: '#b3151b' }, { t: 'andon', x: 0.4, y: 0.4 }, { t: 'urn', x: 1.4, y: 1.4, c: '#f4c842', c2: '#b3151b' }] },
      { floor: 'tatamiGold', name: '宝物の間', items: [GB(0, 2.9, 3, 0.1), { t: 'goldbars', x: 0.95, y: 2.25, w: 0.8, h: 0.6 }, { t: 'goldbars', x: 1.95, y: 2.25, w: 0.8, h: 0.6 }, { t: 'shachi', x: 2.5, y: 0.45 }, { t: 'urn', x: 1.4, y: 1.25, c: '#f4c842', c2: '#1e2a5a' }, { t: 'byobu', x: 0.1, y: 0.1, w: 1.0, h: 0.4, n: 3, gold: true }] },
      { floor: 'tatamiGold', name: '金の大広間', items: [{ t: 'fusuma', x: 0.06, y: 2.8, w: 2.88, h: 0.18, f: 'u', n: 8, gold: true }, { t: 'byobu', x: 0.4, y: 2.25, w: 2.2, h: 0.4, f: 'u', n: 8, gold: true }, { t: 'pillar', x: 0.2, y: 0.4, c: '#a01c1c' }, { t: 'pillar', x: 2.8, y: 0.4, c: '#a01c1c' }, { t: 'shachi', x: 1.5, y: 1.05 }, { t: 'andon', x: 0.4, y: 1.95 }, { t: 'andon', x: 2.6, y: 1.95 }] },
      { floor: 'tatamiGold', name: '奥御殿', items: [GB(0, 2.9, 3, 0.1), GB(2.9, 0, 0.1, 3), { t: 'futon', x: 0.8, y: 1.2, w: 1.1, h: 1.6, f: 'u', c: '#b3151b', gold: true }, { t: 'byobu', x: 2.45, y: 0.15, w: 1.0, h: 0.4, f: 'l', n: 4, gold: true }, { t: 'andon', x: 0.35, y: 2.6 }, { t: 'tokonoma', x: 0.2, y: 0.04, w: 1.3, h: 0.4, gold: true }] },
    ],
  };
  return S[skin] || S.basic;
}

function program(skin, floor) {
  const P = PAL[skin] || PAL.basic;
  if (floor === 0) return floor1(skin, P);
  if (floor === 1) return floor2(skin, P);
  return floor3(skin, P);
}

/* Wall finish strip along the room's top wall (the visible wall face in top-down). */
function drawWallFace(g, spec) {
  const { ctx, u, P } = g;
  const skin = g.skin;
  const X = g.rx, Y = g.ry, W = u * 3, H = u * 0.16;
  if (skin === 'osaka') {
    const gr = ctx.createLinearGradient(X, Y, X, Y + H);
    gr.addColorStop(0, '#fff0a0'); gr.addColorStop(1, '#d9a426');
    ctx.fillStyle = gr; ctx.fillRect(X, Y, W, H);
    ctx.fillStyle = 'rgba(160,100,10,0.45)';
    for (let x = X; x < X + W; x += u * 0.22) ctx.fillRect(x, Y, 1, H);
    ctx.fillStyle = '#a01c1c'; ctx.fillRect(X, Y + H, W, Math.max(1.5, u * 0.04));
    // lacquer side strips
    ctx.fillStyle = '#1e120c'; ctx.fillRect(X, Y, Math.max(1.5, u * 0.04), u * 3); ctx.fillRect(X + W - Math.max(1.5, u * 0.04), Y, Math.max(1.5, u * 0.04), u * 3);
  } else if (skin === 'castle_keep') {
    ctx.fillStyle = '#ece4cc'; ctx.fillRect(X, Y, W, H);
    ctx.fillStyle = 'rgba(40,60,100,0.25)'; ctx.fillRect(X, Y + H * 0.45, W, H * 0.3);
    ctx.fillStyle = P.woodDk;
    for (let x = X; x <= X + W; x += u * 0.5) ctx.fillRect(x, Y, 1.2, H);
    ctx.fillRect(X, Y + H, W, Math.max(1.5, u * 0.035));
  } else if (skin === 'mansion') {
    ctx.fillStyle = '#5a2a30'; ctx.fillRect(X, Y, W, H);
    ctx.fillStyle = 'rgba(220,178,76,0.45)';
    for (let x = X + u * 0.06; x < X + W; x += u * 0.18) { ctx.beginPath(); ctx.arc(x, Y + H / 2, u * 0.025, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = P.gold; ctx.fillRect(X, Y + H, W, Math.max(1, u * 0.025));
  } else if (skin === 'villa') {
    ctx.fillStyle = '#f6f3ee'; ctx.fillRect(X, Y, W, H * 0.7);
    ctx.fillStyle = P.gold; ctx.fillRect(X, Y + H * 0.7, W, Math.max(1, u * 0.02));
  } else if (skin === 'cottage') {
    ctx.fillStyle = '#e9d6a8'; ctx.fillRect(X, Y, W, H * 0.8);
    ctx.fillStyle = 'rgba(184,79,60,0.35)';
    for (let x = X; x < X + W; x += u * 0.12) ctx.fillRect(x, Y, u * 0.04, H * 0.8);
    ctx.fillStyle = P.woodDk; ctx.fillRect(X, Y + H * 0.8, W, Math.max(1, u * 0.03));
  }
}

/* ---------------- render ---------------- */
function renderRoom(g, blueprint, floor, ri, spec) {
  const { ctx, u } = g;
  const [cx0, cy0] = ROOMS[ri];
  g.rx = cx0 * u; g.ry = cy0 * u;
  g.seed = (ri + 1) * 97 + floor * 13;
  ctx.save();
  ctx.beginPath();
  for (let y = cy0; y < cy0 + 3; y++) {
    for (let x = cx0; x < cx0 + 3; x++) {
      if (blueprint[floor][y][x] === FLOOR_T) ctx.rect(x * u, y * u, u, u);
    }
  }
  ctx.clip();
  drawFloorMat(g, spec.floor, g.rx, g.ry, u * 3, u * 3, g.seed);
  const bright = { marble: 1, tatamiGold: 1, tile: 1, checker: 1, carpet: 0, plank: 0 }[spec.floor];
  g.lightK = spec.floor === 'tatamiGold' ? 0.3 : bright ? 0.5 : 0.85;
  drawWallFace(g, spec);
  const flat = (t) => t === 'rug' || t === 'wallband';
  for (const it of spec.items) if (flat(it.t)) DRAW[it.t](g, it);
  for (const it of spec.items) if (!flat(it.t) && DRAW[it.t]) DRAW[it.t](g, it);
  // wall contact shading (room reads as a volume)
  const sh = ctx.createLinearGradient(0, g.ry, 0, g.ry + u * 0.3);
  sh.addColorStop(0, 'rgba(0,0,0,0.25)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh; ctx.fillRect(g.rx, g.ry, u * 3, u * 0.3);
  const sl = ctx.createLinearGradient(g.rx, 0, g.rx + u * 0.2, 0);
  sl.addColorStop(0, 'rgba(0,0,0,0.15)'); sl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sl; ctx.fillRect(g.rx, g.ry, u * 0.2, u * 3);
  flushLights(g);
  for (const p of g.post) p();
  g.post = [];
  ctx.restore();
}

const CACHE = new Map();
const CACHE_MAX = 12;

/** Room-name list (debug / tests). */
export function interiorRoomNames(skinId, floor) {
  return program(skinId, floor).map((r) => r.name);
}

/**
 * Draw cached decor layer for (skin, floor). Purely cosmetic; called before
 * traps/chest/players/fog so gameplay overlays always sit on top.
 */
export function drawInterior(ctx, blueprint, floor, ox, oy, cellSize, skinId = 'basic') {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const scale = Math.min(3, Math.max(1.5, dpr * 1.25));
  const key = `${skinId}|${floor}|${cellSize}|${scale}`;
  let cv = CACHE.get(key);
  if (!cv) {
    const W = Math.ceil(COLS * cellSize * scale), H = Math.ceil(ROWS * cellSize * scale);
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c2 = cv.getContext('2d');
    c2.scale(scale, scale);
    const g = { ctx: c2, skin: skinId, u: cellSize, P: PAL[skinId] || PAL.basic, lights: [], post: [], rx: 0, ry: 0, seed: 1 };
    program(skinId, floor).forEach((spec, ri) => renderRoom(g, blueprint, floor, ri, spec));
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(key, cv);
  }
  ctx.drawImage(cv, ox, oy, COLS * cellSize, ROWS * cellSize);
}
