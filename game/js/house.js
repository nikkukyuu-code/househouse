/**
 * ハウスと罠 — House layout, placement, and rendering helpers
 */

export const TILE = 32;
export const FLOORS = 3;
export const COLS = 13;
export const ROWS = 9;

/** Tile kinds */
export const T = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  STAIRS_UP: 3,
  STAIRS_DOWN: 4,
};

export const MAX_TRAPS = 10;
export const MAX_HP = 10;
/** Bomb damage in hearts (shown with half-hearts) */
export const BOMB_DAMAGE = 1.5;
/** Pitfall damage in hearts */
export const PIT_DAMAGE = 1;

export const TRAP_BOMB = 'bomb';
/** @deprecated alias — old saves used 'normal' */
export const TRAP_NORMAL = TRAP_BOMB;
export const TRAP_PIT = 'pit';

/** Fixed 3-floor house blueprint (same for both players; only chest/traps differ) */
export function createBlueprint() {
  const floors = [];
  for (let f = 0; f < FLOORS; f++) {
    const grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) {
          row.push(T.WALL);
        } else {
          row.push(T.FLOOR);
        }
      }
      grid.push(row);
    }
    floors.push(grid);
  }

  for (let f = 0; f < FLOORS; f++) {
    const g = floors[f];
    for (let y = 1; y < ROWS - 1; y++) {
      g[y][4] = T.WALL;
      g[y][8] = T.WALL;
    }
    for (let x = 1; x < COLS - 1; x++) {
      g[4][x] = T.WALL;
    }
    g[2][4] = T.DOOR;
    g[6][4] = T.DOOR;
    g[2][8] = T.DOOR;
    g[6][8] = T.DOOR;
    g[4][2] = T.DOOR;
    g[4][6] = T.DOOR;
    g[4][10] = T.DOOR;

    if (f < FLOORS - 1) {
      g[1][11] = T.STAIRS_UP;
    }
    if (f > 0) {
      g[7][1] = T.STAIRS_DOWN;
    }
  }

  return floors;
}

export function isWalkable(tile) {
  return tile === T.FLOOR || tile === T.DOOR || tile === T.STAIRS_UP || tile === T.STAIRS_DOWN;
}

export function isPlaceable(blueprint, floor, x, y) {
  if (floor < 0 || floor >= FLOORS) return false;
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false;
  const t = blueprint[floor][y][x];
  return t === T.FLOOR;
}

export function createEmptyHouseData() {
  return {
    chest: null,
    traps: [],
  };
}

/** Normalize trap; missing/'normal' kind → bomb (migration) */
export function normalizeTrap(t) {
  if (!t || typeof t !== 'object') return null;
  const raw = t.kind;
  const kind = raw === TRAP_PIT || raw === 'pit' ? TRAP_PIT : TRAP_BOMB;
  return {
    floor: t.floor | 0,
    x: t.x | 0,
    y: t.y | 0,
    kind,
  };
}

export function serializeHouse(data) {
  return JSON.stringify(data);
}

export function parseHouse(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || typeof d !== 'object') throw new Error('invalid house');
  const traps = Array.isArray(d.traps)
    ? d.traps.map(normalizeTrap).filter(Boolean)
    : [];
  return {
    chest: d.chest || null,
    traps,
  };
}

export function validateHouse(data, blueprint) {
  if (!data.chest) return { ok: false, msg: '宝箱を1つ配置してください' };
  const { floor, x, y } = data.chest;
  if (!isPlaceable(blueprint, floor, x, y)) return { ok: false, msg: '宝箱の位置が不正です' };
  if (data.traps.length > MAX_TRAPS) return { ok: false, msg: `罠は最大${MAX_TRAPS}個です` };
  if (data.traps.length < MAX_TRAPS) {
    return { ok: false, msg: `罠を${MAX_TRAPS}個すべて配置してください（いま ${data.traps.length}/${MAX_TRAPS}）` };
  }
  const seen = new Set();
  seen.add(`${floor},${x},${y}`);
  for (const raw of data.traps) {
    const t = normalizeTrap(raw);
    if (!t || !isPlaceable(blueprint, t.floor, t.x, t.y)) {
      return { ok: false, msg: '罠の位置が不正です' };
    }
    const key = `${t.floor},${t.x},${t.y}`;
    if (seen.has(key)) return { ok: false, msg: '同じマスに複数置けません' };
    seen.add(key);
  }
  return { ok: true };
}

export function getSpawn() {
  return { floor: 0, x: 6, y: 7 };
}

export function tileAt(blueprint, floor, x, y) {
  if (floor < 0 || floor >= FLOORS || x < 0 || y < 0 || x >= COLS || y >= ROWS) return T.WALL;
  return blueprint[floor][y][x];
}

export const COLORS = {
  wall: '#4a3428',
  wallTop: '#5c4334',
  wallEdge: '#2a1c14',
  wallShadow: 'rgba(0,0,0,0.35)',
  floor: '#e6d0a8',
  floorAlt: '#d9c094',
  floorGrain: 'rgba(120,80,40,0.12)',
  door: '#8b6914',
  doorLight: '#c9a227',
  doorDark: '#5c4010',
  stairsUp: '#5b8c5a',
  stairsUpHi: '#7ab87a',
  stairsDown: '#4a7c9b',
  stairsDownHi: '#6aa0c0',
  chest: '#c9a227',
  chestLid: '#e8c547',
  chestEdge: '#8a6a12',
  chestLock: '#5c4010',
  trap: '#8b0000',
  trapArmed: '#cc2222',
  pitDark: '#0a080c',
  pitRim: '#3a3028',
  player1: '#3b82f6',
  player2: '#ef4444',
  ghost: 'rgba(100,100,100,0.35)',
  bg: '#1a1520',
  roomLabel: 'rgba(0,0,0,0.15)',
};

/**
 * Per-floor house look — distinct floor/wall tints so players know which floor they're on.
 * 0=1F warm oak, 1=2F cool blue-gray wood, 2=3F rosy attic.
 */
export const FLOOR_THEMES = [
  {
    name: '1F',
    floor: '#e8c98a',
    floorAlt: '#d9b56e',
    floorGrain: 'rgba(110,70,25,0.18)',
    wall: '#6b4430',
    wallTop: '#8a5a3c',
    wallEdge: '#3a2418',
    baseboard: '#4a2e1c',
    door: '#a07028',
    doorDark: '#6a4410',
    doorLight: '#e8c060',
    rug: 'rgba(180,60,50,0.22)',
    glow: 'rgba(255,210,140,0.10)',
    badge: '#f0b429',
  },
  {
    name: '2F',
    floor: '#b8c8d8',
    floorAlt: '#a0b4c8',
    floorGrain: 'rgba(40,60,90,0.16)',
    wall: '#4a5568',
    wallTop: '#627088',
    wallEdge: '#2a3340',
    baseboard: '#343e4c',
    door: '#6a7a98',
    doorDark: '#3a4860',
    doorLight: '#c0d0e8',
    rug: 'rgba(70,110,180,0.22)',
    glow: 'rgba(160,200,255,0.10)',
    badge: '#6aa8e8',
  },
  {
    name: '3F',
    floor: '#e8b8b0',
    floorAlt: '#d8a098',
    floorGrain: 'rgba(120,50,45,0.16)',
    wall: '#7a4a55',
    wallTop: '#9a606c',
    wallEdge: '#4a2830',
    baseboard: '#5a3038',
    door: '#a06068',
    doorDark: '#6a3840',
    doorLight: '#f0c0c0',
    rug: 'rgba(200,80,120,0.2)',
    glow: 'rgba(255,180,190,0.10)',
    badge: '#e888a0',
  },
];

export function themeForFloor(floor) {
  return FLOOR_THEMES[Math.max(0, Math.min(FLOORS - 1, floor | 0))];
}

function drawWoodFloor(ctx, px, py, cellSize, x, y, floor = 0) {
  const th = themeForFloor(floor);
  const alt = (x + y) % 2 === 0;
  ctx.fillStyle = alt ? th.floor : th.floorAlt;
  ctx.fillRect(px, py, cellSize, cellSize);
  // Plank lines (more house-like)
  ctx.strokeStyle = th.floorGrain;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 1, py + cellSize * 0.33);
  ctx.lineTo(px + cellSize - 1, py + cellSize * 0.33 + ((x + y) % 2));
  ctx.moveTo(px + 1, py + cellSize * 0.66);
  ctx.lineTo(px + cellSize - 1, py + cellSize * 0.66 - ((x * 3 + y) % 2));
  // Vertical seam every other tile
  if (x % 2 === 0) {
    ctx.moveTo(px + cellSize * 0.5, py + 1);
    ctx.lineTo(px + cellSize * 0.5, py + cellSize - 1);
  }
  ctx.stroke();
  ctx.fillStyle = th.glow;
  ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize * 0.28);
}

function drawWallTile(ctx, px, py, cellSize, floor = 0) {
  const th = themeForFloor(floor);
  ctx.fillStyle = th.wall;
  ctx.fillRect(px, py, cellSize, cellSize);
  // Plaster / panel top
  ctx.fillStyle = th.wallTop;
  ctx.fillRect(px, py, cellSize, Math.max(3, cellSize * 0.2));
  // Baseboard
  ctx.fillStyle = th.baseboard;
  ctx.fillRect(px, py + cellSize - Math.max(4, cellSize * 0.16), cellSize, Math.max(4, cellSize * 0.16));
  // Edge
  ctx.fillStyle = th.wallEdge;
  ctx.fillRect(px, py, cellSize, 2);
  ctx.fillRect(px, py, 2, cellSize);
  // Tiny wall panel line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 3, py + cellSize * 0.22, cellSize - 6, cellSize * 0.5);
}

function drawDoorTile(ctx, px, py, cellSize, floor = 0) {
  const th = themeForFloor(floor);
  drawWoodFloor(ctx, px, py, cellSize, 0, 0, floor);
  const m = Math.max(3, cellSize * 0.1);
  // Door frame (house trim)
  ctx.fillStyle = th.baseboard;
  ctx.fillRect(px + m - 2, py + m - 2, cellSize - (m - 2) * 2, cellSize - (m - 2) * 2);
  ctx.fillStyle = th.doorDark;
  ctx.fillRect(px + m, py + m, cellSize - m * 2, cellSize - m * 2);
  ctx.fillStyle = th.door;
  ctx.fillRect(px + m + 2, py + m + 2, cellSize - m * 2 - 4, cellSize - m * 2 - 4);
  // Panels
  const pw = (cellSize - m * 2 - 8) / 2 - 1;
  const ph = (cellSize - m * 2 - 10) / 2 - 1;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(px + m + 4, py + m + 4, pw, ph);
  ctx.fillRect(px + m + 5 + pw, py + m + 4, pw, ph);
  ctx.fillRect(px + m + 4, py + m + 6 + ph, pw, ph);
  ctx.fillRect(px + m + 5 + pw, py + m + 6 + ph, pw, ph);
  ctx.strokeStyle = th.doorLight;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + m + 1, py + m + 1, cellSize - m * 2 - 2, cellSize - m * 2 - 2);
  // Knob
  ctx.fillStyle = th.doorLight;
  ctx.beginPath();
  ctx.arc(px + cellSize * 0.74, py + cellSize * 0.52, cellSize * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

/** Clear stairwell: perspective steps + rail + destination label */
function drawStairsTile(ctx, px, py, cellSize, up, floor = 0) {
  const th = themeForFloor(floor);
  // Landing floor under stairs
  drawWoodFloor(ctx, px, py, cellSize, 1, 1, floor);

  const steps = 5;
  const left = px + cellSize * 0.12;
  const right = px + cellSize * 0.88;
  const topY = py + cellSize * 0.12;
  const botY = py + cellSize * 0.88;

  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    // Rising stairs widen toward bottom; descending toward top feels like going down
    const y0 = up ? topY + (botY - topY) * t0 : botY - (botY - topY) * t0;
    const y1 = up ? topY + (botY - topY) * t1 : botY - (botY - topY) * t1;
    const inset0 = up ? cellSize * 0.08 * (1 - t0) : cellSize * 0.08 * t0;
    const inset1 = up ? cellSize * 0.08 * (1 - t1) : cellSize * 0.08 * t1;
    const x0 = left + inset0;
    const x1 = right - inset0;
    const treadH = Math.abs(y1 - y0);

    // Riser
    ctx.fillStyle = i % 2 === 0 ? '#8a7355' : '#7a6348';
    ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, treadH);
    // Tread highlight
    ctx.fillStyle = i % 2 === 0 ? '#c4a882' : '#b89870';
    ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.max(2, treadH * 0.35));
    // Edge shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x0, Math.max(y0, y1) - 1, x1 - x0, 2);
  }

  // Side rails
  ctx.strokeStyle = '#5c4030';
  ctx.lineWidth = Math.max(2, cellSize * 0.06);
  ctx.beginPath();
  if (up) {
    ctx.moveTo(left, botY);
    ctx.lineTo(left + cellSize * 0.06, topY);
    ctx.moveTo(right, botY);
    ctx.lineTo(right - cellSize * 0.06, topY);
  } else {
    ctx.moveTo(left, topY);
    ctx.lineTo(left + cellSize * 0.06, botY);
    ctx.moveTo(right, topY);
    ctx.lineTo(right - cellSize * 0.06, botY);
  }
  ctx.stroke();

  // Banner: 階段 + destination floor (1-based labels)
  const destLabel = up ? `${floor + 2}Fへ` : `${floor}Fへ`;
  const bannerY = py + cellSize * 0.08;
  ctx.fillStyle = up ? 'rgba(40,120,60,0.92)' : 'rgba(40,90,140,0.92)';
  ctx.fillRect(px + 2, bannerY, cellSize - 4, cellSize * 0.28);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(8, Math.floor(cellSize * 0.22))}px "Hiragino Sans","Noto Sans JP",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`階段 ${destLabel}`, px + cellSize / 2, bannerY + cellSize * 0.14);

  // Big arrow
  ctx.font = `bold ${Math.floor(cellSize * 0.28)}px sans-serif`;
  ctx.fillStyle = up ? '#b8ffb8' : '#b8d8ff';
  ctx.fillText(up ? '▲' : '▼', px + cellSize / 2, py + cellSize * 0.72);
}

/** Draw a trap sprite (bomb / pit hole) */
export function drawTrapSprite(ctx, tr, triggered, px, py, cellSize) {
  const kind = tr.kind === TRAP_PIT ? TRAP_PIT : TRAP_BOMB;
  const cx = px + cellSize / 2;
  const cy = py + cellSize / 2;

  if (kind === TRAP_PIT) {
    if (triggered) {
      // Spent / visible hole
      ctx.fillStyle = COLORS.pitRim;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, cellSize * 0.38, cellSize * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.pitDark;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cellSize * 0.32, cellSize * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crack lines
      ctx.strokeStyle = 'rgba(20,15,10,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - cellSize * 0.35, cy);
      ctx.lineTo(cx - cellSize * 0.15, cy - cellSize * 0.08);
      ctx.lineTo(cx + cellSize * 0.05, cy + cellSize * 0.05);
      ctx.moveTo(cx + cellSize * 0.1, cy - cellSize * 0.12);
      ctx.lineTo(cx + cellSize * 0.32, cy + cellSize * 0.02);
      ctx.stroke();
    } else {
      // Armed pit — cracked floor hint (designer view)
      ctx.fillStyle = 'rgba(30,20,15,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, cellSize * 0.36, cellSize * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.pitDark;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cellSize * 0.28, cellSize * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6a5040';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - cellSize * 0.3, cy - cellSize * 0.05);
      ctx.lineTo(cx - cellSize * 0.05, cy + cellSize * 0.1);
      ctx.lineTo(cx + cellSize * 0.28, cy - cellSize * 0.02);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,200,100,0.35)';
      ctx.font = `bold ${Math.floor(cellSize * 0.28)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('穴', cx, cy);
    }
    return;
  }

  // Bomb (was normal trap)
  if (triggered) {
    // Scorch mark after boom
    ctx.fillStyle = 'rgba(40, 25, 15, 0.75)';
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1810';
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8844';
    ctx.font = `bold ${Math.floor(cellSize * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('爆', cx, cy + 1);
  } else {
    // Round bomb body
    const r = cellSize * 0.28;
    ctx.fillStyle = '#1a1a22';
    ctx.beginPath();
    ctx.arc(cx, cy + cellSize * 0.04, r, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.28, cy - r * 0.15, r * 0.35, r * 0.22, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Fuse
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = Math.max(1.5, cellSize * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.75);
    ctx.quadraticCurveTo(cx + r * 0.45, cy - r * 1.15, cx + r * 0.15, cy - r * 1.35);
    ctx.stroke();
    // Spark
    ctx.fillStyle = '#ffcc44';
    ctx.beginPath();
    ctx.arc(cx + r * 0.15, cy - r * 1.35, cellSize * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff6622';
    ctx.beginPath();
    ctx.arc(cx + r * 0.15, cy - r * 1.35, cellSize * 0.035, 0, Math.PI * 2);
    ctx.fill();
    // Label
    ctx.fillStyle = '#ffe08a';
    ctx.font = `bold ${Math.floor(cellSize * 0.22)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('爆弾', cx, cy + cellSize * 0.06);
  }
}

export function drawChestSprite(ctx, px, py, cellSize) {
  const m = Math.max(3, cellSize * 0.12);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px + m + 2, py + cellSize - m, cellSize - m * 2, 3);
  // Body
  const bodyY = py + cellSize * 0.38;
  const bodyH = cellSize * 0.48;
  ctx.fillStyle = COLORS.chestEdge;
  ctx.fillRect(px + m, bodyY, cellSize - m * 2, bodyH);
  ctx.fillStyle = COLORS.chest;
  ctx.fillRect(px + m + 2, bodyY + 2, cellSize - m * 2 - 4, bodyH - 4);
  // Gold highlight stripe
  ctx.fillStyle = 'rgba(255,240,160,0.45)';
  ctx.fillRect(px + m + 3, bodyY + 3, cellSize - m * 2 - 6, 3);
  // Lid
  ctx.fillStyle = COLORS.chestEdge;
  ctx.fillRect(px + m - 1, py + cellSize * 0.22, cellSize - m * 2 + 2, cellSize * 0.22);
  ctx.fillStyle = COLORS.chestLid;
  ctx.fillRect(px + m + 1, py + cellSize * 0.24, cellSize - m * 2 - 2, cellSize * 0.16);
  ctx.fillStyle = 'rgba(255,255,220,0.5)';
  ctx.fillRect(px + m + 2, py + cellSize * 0.25, cellSize - m * 2 - 4, 3);
  // Lock
  ctx.fillStyle = COLORS.chestLock;
  const lx = px + cellSize / 2 - 3;
  const ly = py + cellSize * 0.42;
  ctx.fillRect(lx, ly, 6, 7);
  ctx.fillStyle = '#e8c547';
  ctx.fillRect(lx + 1, ly + 1, 4, 3);
}

export function drawHouse(ctx, blueprint, houseData, floor, opts = {}) {
  const {
    showChest = false,
    showTraps = false,
    triggeredTraps = new Set(),
    ox = 0,
    oy = 0,
    cellSize = TILE,
    vignette = true,
  } = opts;

  const mapW = COLS * cellSize;
  const mapH = ROWS * cellSize;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = blueprint[floor][y][x];
      const px = ox + x * cellSize;
      const py = oy + y * cellSize;

      if (t === T.WALL) {
        drawWallTile(ctx, px, py, cellSize, floor);
      } else if (t === T.DOOR) {
        drawDoorTile(ctx, px, py, cellSize, floor);
      } else if (t === T.STAIRS_UP) {
        drawStairsTile(ctx, px, py, cellSize, true, floor);
      } else if (t === T.STAIRS_DOWN) {
        drawStairsTile(ctx, px, py, cellSize, false, floor);
      } else {
        drawWoodFloor(ctx, px, py, cellSize, x, y, floor);
      }
    }
  }

  // Soft rugs in room centers (house feel)
  const th = themeForFloor(floor);
  const rugCells = [
    [2, 2], [6, 2], [10, 2],
    [2, 6], [6, 6], [10, 6],
  ];
  for (const [rx, ry] of rugCells) {
    if (blueprint[floor][ry][rx] !== T.FLOOR) continue;
    const rpx = ox + rx * cellSize;
    const rpy = oy + ry * cellSize;
    ctx.fillStyle = th.rug;
    const rr = cellSize * 0.08;
    const rx0 = rpx + cellSize * 0.15;
    const ry0 = rpy + cellSize * 0.15;
    const rw = cellSize * 0.7;
    const rh = cellSize * 0.7;
    ctx.beginPath();
    ctx.moveTo(rx0 + rr, ry0);
    ctx.arcTo(rx0 + rw, ry0, rx0 + rw, ry0 + rh, rr);
    ctx.arcTo(rx0 + rw, ry0 + rh, rx0, ry0 + rh, rr);
    ctx.arcTo(rx0, ry0 + rh, rx0, ry0, rr);
    ctx.arcTo(rx0, ry0, rx0 + rw, ry0, rr);
    ctx.closePath();
    ctx.fill();
  }

  // Soft floor ambient glow in center (tinted per floor)
  if (vignette) {
    const grd = ctx.createRadialGradient(
      ox + mapW / 2, oy + mapH / 2, mapW * 0.15,
      ox + mapW / 2, oy + mapH / 2, mapW * 0.72
    );
    grd.addColorStop(0, th.glow);
    grd.addColorStop(0.55, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = grd;
    ctx.fillRect(ox, oy, mapW, mapH);
  }

  // Floor badge (1F/2F/3F) — always visible
  const badge = th.name;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const bw = Math.max(36, cellSize * 1.4);
  const bh = Math.max(16, cellSize * 0.55);
  ctx.fillRect(ox + 4, oy + 4, bw, bh);
  ctx.fillStyle = th.badge;
  ctx.font = `bold ${Math.max(11, Math.floor(cellSize * 0.38))}px "Hiragino Sans","Noto Sans JP",sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, ox + 10, oy + 4 + bh / 2);

  if (showTraps && houseData) {
    for (const raw of houseData.traps) {
      const tr = normalizeTrap(raw);
      if (!tr || tr.floor !== floor) continue;
      const key = `${tr.floor},${tr.x},${tr.y}`;
      const px = ox + tr.x * cellSize;
      const py = oy + tr.y * cellSize;
      drawTrapSprite(ctx, tr, triggeredTraps.has(key), px, py, cellSize);
    }
  }

  if (showChest && houseData && houseData.chest && houseData.chest.floor === floor) {
    const c = houseData.chest;
    drawChestSprite(ctx, ox + c.x * cellSize, oy + c.y * cellSize, cellSize);
  }
}

export function drawPlayer(ctx, x, y, color, ox, oy, cellSize = TILE, pulse = 0) {
  const px = ox + x * cellSize + cellSize / 2;
  const py = oy + y * cellSize + cellSize / 2;
  const bob = Math.sin(pulse) * 1.2;
  const s = cellSize;

  // Soft shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(px, py + s * 0.28, s * 0.22, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = shadeColor(color, -35);
  ctx.fillRect(px - s * 0.14, py + s * 0.08 + bob, s * 0.1, s * 0.18);
  ctx.fillRect(px + s * 0.04, py + s * 0.08 + bob, s * 0.1, s * 0.18);

  // Body
  ctx.fillStyle = color;
  roundRect(ctx, px - s * 0.2, py - s * 0.12 + bob, s * 0.4, s * 0.28, 3);
  ctx.fill();
  // Body highlight
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, px - s * 0.16, py - s * 0.1 + bob, s * 0.32, s * 0.1, 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#f5d0b0';
  ctx.beginPath();
  ctx.arc(px, py - s * 0.22 + bob, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  // Hair / cap in player color
  ctx.fillStyle = shadeColor(color, -20);
  ctx.beginPath();
  ctx.arc(px, py - s * 0.28 + bob, s * 0.17, Math.PI, 0);
  ctx.fill();

  // Eyes
  ctx.fillStyle = '#1a1020';
  ctx.beginPath();
  ctx.arc(px - s * 0.06, py - s * 0.22 + bob, s * 0.035, 0, Math.PI * 2);
  ctx.arc(px + s * 0.06, py - s * 0.22 + bob, s * 0.035, 0, Math.PI * 2);
  ctx.fill();
  // Eye shine
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px - s * 0.05, py - s * 0.23 + bob, s * 0.015, 0, Math.PI * 2);
  ctx.arc(px + s * 0.07, py - s * 0.23 + bob, s * 0.015, 0, Math.PI * 2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = '#8a5040';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py - s * 0.16 + bob, s * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shadeColor(hex, amt) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const clamp = (n) => Math.max(0, Math.min(255, n));
  const r = clamp(parseInt(m[1], 16) + amt);
  const g = clamp(parseInt(m[2], 16) + amt);
  const b = clamp(parseInt(m[3], 16) + amt);
  return `rgb(${r},${g},${b})`;
}

export function floorLabel(f) {
  return `${f + 1}F`;
}

export function listPlaceable(blueprint) {
  const cells = [];
  for (let f = 0; f < FLOORS; f++) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (isPlaceable(blueprint, f, x, y)) cells.push({ floor: f, x, y });
      }
    }
  }
  return cells;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * COM house generation: chest far from spawn (upper floors),
 * traps where the human explorer is most likely to get caught —
 * spawn exits, door choke points, stairs on the climb, chest approaches.
 * Uses BFS player-traffic heat from spawn (stairs connect floors).
 * Door-adjacent / spawn-exit cells prefer bombs; pits prefer upper floors.
 */
export function generateComHouse(blueprint) {
  const cells = listPlaceable(blueprint);
  const spawn = getSpawn();
  // Stronger upper-floor bias for chest distance
  const dist = (c) => Math.abs(c.x - spawn.x) + Math.abs(c.y - spawn.y) + c.floor * 8;

  const chestCandidates = shuffle(cells)
    .filter((c) => !(c.floor === spawn.floor && c.x === spawn.x && c.y === spawn.y))
    .map((c) => {
      // Extra bias: prefer floor 2, then 1, rarely 0
      let bonus = c.floor * 6;
      if (c.floor === FLOORS - 1) bonus += 4;
      return { c, s: dist(c) + bonus + Math.random() * 3 };
    })
    .sort((a, b) => b.s - a.s);
  const topN = Math.max(4, Math.min(12, (chestCandidates.length * 0.25) | 0));
  const chest = chestCandidates[(Math.random() * topN) | 0].c;

  const used = new Set([`${chest.floor},${chest.x},${chest.y}`]);
  const spawnKey = `${spawn.floor},${spawn.x},${spawn.y}`;
  used.add(spawnKey); // never place on spawn

  function keyOf(f, x, y) {
    return `${f},${x},${y}`;
  }

  function isAdjTo(c, tileKind) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (tileAt(blueprint, c.floor, c.x + dx, c.y + dy) === tileKind) return true;
    }
    return false;
  }

  function walkableNeighborCount(c) {
    let n = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (isWalkable(tileAt(blueprint, c.floor, c.x + dx, c.y + dy))) n += 1;
    }
    return n;
  }

  /** Same room as spawn on 1F: walls at x=4,8 and y=4 split rooms; spawn is (6,7) → center-bottom room */
  function inSpawnRoom(c) {
    if (c.floor !== spawn.floor) return false;
    return c.x > 4 && c.x < 8 && c.y > 4 && c.y < ROWS - 1;
  }

  function nearSpawnExit(c) {
    if (c.floor !== 0) return false;
    if (inSpawnRoom(c) && isAdjTo(c, T.DOOR)) return true;
    if (!inSpawnRoom(c) && isAdjTo(c, T.DOOR)) {
      const man = Math.abs(c.x - spawn.x) + Math.abs(c.y - spawn.y);
      if (man <= 6) return true;
    }
    const man = Math.abs(c.x - spawn.x) + Math.abs(c.y - spawn.y);
    if (c.floor === 0 && man >= 1 && man <= 3) return true;
    return false;
  }

  /**
   * BFS from spawn across walkable tiles; stairs connect floors
   * (UP → next floor DOWN landing, DOWN → prev floor UP landing).
   * heat[key] = visit likelihood: early / must-pass cells score high.
   */
  function buildPlayerHeat() {
    const heat = new Map();
    const distMap = new Map();
    const q = [];
    const sk = keyOf(spawn.floor, spawn.x, spawn.y);
    distMap.set(sk, 0);
    q.push({ floor: spawn.floor, x: spawn.x, y: spawn.y });

    let qi = 0;
    while (qi < q.length) {
      const cur = q[qi++];
      const ck = keyOf(cur.floor, cur.x, cur.y);
      const d = distMap.get(ck);
      const tile = tileAt(blueprint, cur.floor, cur.x, cur.y);

      const neighbors = [];
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!isWalkable(tileAt(blueprint, cur.floor, nx, ny))) continue;
        neighbors.push({ floor: cur.floor, x: nx, y: ny });
      }
      // Stairs transitions
      if (tile === T.STAIRS_UP && cur.floor < FLOORS - 1) {
        // Land on STAIRS_DOWN of next floor (blueprint: (1,7))
        neighbors.push({ floor: cur.floor + 1, x: 1, y: 7 });
      }
      if (tile === T.STAIRS_DOWN && cur.floor > 0) {
        // Land on STAIRS_UP of prev floor (blueprint: (11,1))
        neighbors.push({ floor: cur.floor - 1, x: 11, y: 1 });
      }

      for (const n of neighbors) {
        const nk = keyOf(n.floor, n.x, n.y);
        if (distMap.has(nk)) continue;
        distMap.set(nk, d + 1);
        q.push(n);
      }
    }

    // Convert distance → heat: closer to spawn = higher base traffic;
    // boost cells on path toward chest floor (floor ≤ chest.floor).
    const maxD = Math.max(1, ...distMap.values());
    for (const [k, d] of distMap) {
      const [fs, xs, ys] = k.split(',').map(Number);
      // Early cells the player must pass: high heat
      let h = (maxD - d + 1) / maxD; // 1 at spawn, decays with distance
      h = h * h; // emphasize very early path
      // Soft boost for cells on or below chest floor (route up)
      if (fs <= chest.floor) h += 0.2;
      // Extra for first ~12 steps (spawn exits / first room)
      if (d >= 1 && d <= 12) h += 0.35 * (1 - (d - 1) / 12);
      // Stairs / door approaches on the climb — strong catch chokes
      const cell = { floor: fs, x: xs, y: ys };
      if (fs <= chest.floor) {
        if (isAdjTo(cell, T.STAIRS_UP) || isAdjTo(cell, T.STAIRS_DOWN)) {
          h += 0.55;
          // Intermediate floors between spawn and chest are must-pass climbs
          if (fs > 0 && fs < chest.floor) h += 0.35;
          else if (fs > 0) h += 0.2;
        }
        if (isAdjTo(cell, T.DOOR) && d <= 28) {
          h += 0.3;
          if (fs > 0 && fs <= chest.floor) h += 0.25;
        }
      }
      heat.set(k, h);
    }
    return { heat, distMap };
  }

  const { heat: playerHeat } = buildPlayerHeat();

  function heatOf(c) {
    return playerHeat.get(keyOf(c.floor, c.x, c.y)) || 0;
  }

  function onPathToChest(c) {
    if (c.floor > chest.floor) return false;
    if (c.floor < chest.floor) return true;
    // Same floor: closer to chest along spawn→chest corridor
    const cd = Math.abs(c.x - chest.x) + Math.abs(c.y - chest.y);
    return cd <= 8;
  }

  function nearStairs(c) {
    return isAdjTo(c, T.STAIRS_UP) || isAdjTo(c, T.STAIRS_DOWN);
  }

  function nearChest(c) {
    if (c.floor !== chest.floor) return false;
    const cd = Math.abs(c.x - chest.x) + Math.abs(c.y - chest.y);
    return cd >= 1 && cd <= 3;
  }

  function trapScore(c) {
    let s = 0;
    const doorAdj = isAdjTo(c, T.DOOR);
    const stairsAdj = nearStairs(c);
    // Player traffic heat (primary catch signal)
    s += heatOf(c) * 10;
    if (doorAdj) s += 7;
    if (stairsAdj && c.floor <= chest.floor) s += 6;
    if (nearSpawnExit(c)) s += 6;
    if (nearChest(c)) s += 5;
    if (onPathToChest(c)) s += 3;
    if (c.floor === chest.floor) s += 2;
    // Corridor-like choke
    const wn = walkableNeighborCount(c);
    if (wn <= 2) s += 4;
    else if (wn === 3) s += 1;
    // Prefer floors the player must visit
    if (c.floor > chest.floor) s -= 4;
    else if (c.floor > 0) s += 1;
    s += Math.random() * 1.2;
    return s;
  }

  function pickKind(c) {
    const doorAdj = isAdjTo(c, T.DOOR);
    const spawnExit = nearSpawnExit(c);
    // Door / spawn-exit: strongly prefer bomb (~90%)
    if (doorAdj || spawnExit) {
      if (Math.random() < 0.9) return TRAP_BOMB;
      return TRAP_PIT;
    }
    // Upper floors: pits more often (keep pit mix where it makes sense)
    if (c.floor >= 2 && Math.random() < 0.55) return TRAP_PIT;
    if (c.floor === 1 && Math.random() < 0.4) return TRAP_PIT;
    if (c.floor === 0 && Math.random() < 0.15) return TRAP_PIT;
    if (Math.random() < 0.3) return TRAP_PIT;
    return TRAP_BOMB;
  }

  function canPlace(c) {
    const key = keyOf(c.floor, c.x, c.y);
    if (used.has(key)) return false;
    if (c.floor === spawn.floor && c.x === spawn.x && c.y === spawn.y) return false;
    if (c.floor === chest.floor && c.x === chest.x && c.y === chest.y) return false;
    if (!isPlaceable(blueprint, c.floor, c.x, c.y)) return false;
    return true;
  }

  function placeTrap(c, kindForce) {
    const key = keyOf(c.floor, c.x, c.y);
    used.add(key);
    const kind = kindForce || pickKind(c);
    traps.push({ floor: c.floor, x: c.x, y: c.y, kind });
  }

  const eligible = cells.filter(canPlace);
  const traps = [];
  const want = MAX_TRAPS;

  function ranked(filterFn, scoreFn) {
    return eligible
      .filter((c) => canPlace(c) && filterFn(c))
      .map((c) => ({ c, s: scoreFn(c) }))
      .sort((a, b) => b.s - a.s);
  }

  function countFloor(f) {
    let n = 0;
    for (const t of traps) if (t.floor === f) n += 1;
    return n;
  }

  // --- Quota placement (fill catch spots first) ---
  // 1) ~3 bombs on spawn-exit / first-room-exit
  {
    const pool = ranked(nearSpawnExit, (c) => heatOf(c) * 8 + trapScore(c));
    let n = 0;
    for (const { c } of pool) {
      if (traps.length >= want || n >= 3) break;
      if (!canPlace(c)) continue;
      placeTrap(c, TRAP_BOMB);
      n += 1;
    }
  }

  // 2) ~2–3 bombs on door-adjacent (any floor, prefer path to chest; spread floors)
  {
    const doorQuota = 2 + ((Math.random() < 0.5) ? 1 : 0); // 2 or 3
    const usedDoorFloors = new Set();
    const pool = ranked(
      (c) => isAdjTo(c, T.DOOR) && !nearSpawnExit(c) && c.floor <= chest.floor,
      (c) =>
        (onPathToChest(c) ? 5 : 0) +
        heatOf(c) * 5 +
        (c.floor > 0 ? 4 : 0) + // prefer climb floors after spawn-exit bombs
        (countFloor(c.floor) >= 4 ? -8 : 0) +
        (usedDoorFloors.has(c.floor) ? -3 : 2) +
        trapScore(c)
    );
    let n = 0;
    for (const { c } of pool) {
      if (traps.length >= want || n >= doorQuota) break;
      if (!canPlace(c)) continue;
      // Soft: avoid piling all door bombs on already-heavy floor 0
      if (c.floor === 0 && countFloor(0) >= 5 && n < doorQuota - 1) continue;
      placeTrap(c, TRAP_BOMB);
      usedDoorFloors.add(c.floor);
      n += 1;
    }
    // Fallback if soft-skip starved the quota
    if (n < doorQuota) {
      for (const { c } of pool) {
        if (traps.length >= want || n >= doorQuota) break;
        if (!canPlace(c)) continue;
        placeTrap(c, TRAP_BOMB);
        n += 1;
      }
    }
  }

  // 3) ~2 traps near stairs on floors ≤ chest floor (prefer distinct floors on the climb)
  {
    const pool = ranked(
      (c) => nearStairs(c) && c.floor <= chest.floor,
      (c) =>
        heatOf(c) * 5 +
        trapScore(c) +
        (c.floor > 0 && c.floor < chest.floor ? 6 : 0) +
        (c.floor > 0 ? 3 : 1)
    );
    const stairFloors = new Set();
    let n = 0;
    // First pass: one per floor
    for (const { c } of pool) {
      if (traps.length >= want || n >= 2) break;
      if (!canPlace(c)) continue;
      if (stairFloors.has(c.floor)) continue;
      placeTrap(c);
      stairFloors.add(c.floor);
      n += 1;
    }
    // Second pass: fill remaining stairs quota
    for (const { c } of pool) {
      if (traps.length >= want || n >= 2) break;
      if (!canPlace(c)) continue;
      placeTrap(c);
      n += 1;
    }
  }

  // 4) ~2 near the chest (same floor, dist 1–3)
  {
    const pool = ranked(nearChest, (c) => {
      const cd = Math.abs(c.x - chest.x) + Math.abs(c.y - chest.y);
      return (4 - cd) * 3 + heatOf(c) * 4 + trapScore(c);
    });
    let n = 0;
    for (const { c } of pool) {
      if (traps.length >= want || n >= 2) break;
      if (!canPlace(c)) continue;
      placeTrap(c);
      n += 1;
    }
  }

  // 5) Fill remaining from high heat + choke scores (spread across climb floors)
  {
    const pool = ranked(() => true, (c) => {
      let s = trapScore(c);
      const fc = countFloor(c.floor);
      if (c.floor <= chest.floor && fc === 0) s += 5; // cover empty climb floors
      if (fc >= 4) s -= 6;
      if (c.floor === 0 && fc >= 5) s -= 8;
      return s;
    });
    const perFloor = {};
    for (const t of traps) perFloor[t.floor] = (perFloor[t.floor] || 0) + 1;

    for (const { c } of pool) {
      if (traps.length >= want) break;
      if (!canPlace(c)) continue;
      const fc = perFloor[c.floor] || 0;
      // Soft cap for spread until late fills
      if (fc >= 4 && traps.length < want - 2) continue;
      if (c.floor === 0 && fc >= 5 && traps.length < want - 1) continue;
      placeTrap(c);
      perFloor[c.floor] = fc + 1;
    }
    // Remainder if soft-cap skipped too many
    if (traps.length < want) {
      for (const { c } of pool) {
        if (traps.length >= want) break;
        if (!canPlace(c)) continue;
        placeTrap(c);
      }
    }
  }

  // Guarantee mix of bomb + pit
  if (traps.length >= 2) {
    const hasPit = traps.some((t) => t.kind === TRAP_PIT);
    const hasBomb = traps.some((t) => t.kind === TRAP_BOMB);
    if (!hasPit) {
      const idx = traps.findIndex((t) => {
        const c = { floor: t.floor, x: t.x, y: t.y };
        return !isAdjTo(c, T.DOOR) && !nearSpawnExit(c);
      });
      traps[idx >= 0 ? idx : 0].kind = TRAP_PIT;
    }
    if (!hasBomb) traps[traps.length - 1].kind = TRAP_BOMB;
  }

  return { chest: { floor: chest.floor, x: chest.x, y: chest.y }, traps };
}

