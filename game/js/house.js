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

/** Cosmetic house skins (shop). Gameplay layout unchanged. */
export const HOUSE_SKINS = [
  {
    id: 'basic',
    name: 'ふつうの家',
    price: 0,
    swatch: ['#e8c98a', '#6b4430', '#d9b56e'],
    ornaments: 'none',
    desc: '簡素な家具・リビング／寝室／屋根裏',
  },
  {
    id: 'cottage',
    name: 'こざっぱりした家',
    price: 15,
    swatch: ['#f2e0b0', '#8a6548', '#c8d8a8'],
    ornaments: 'none',
    desc: 'カーテン・コンロ・木家具のあたたかさ',
  },
  {
    id: 'mansion',
    name: '洋館',
    price: 40,
    swatch: ['#d8c8a8', '#5a4a3a', '#8a3040'],
    ornaments: 'trim',
    desc: '暖炉・シャンデリア・書棚の西洋館',
  },
  {
    id: 'villa',
    name: '大邸宅',
    price: 80,
    swatch: ['#e8e4d8', '#6a6870', '#d4af37'],
    ornaments: 'trim',
    desc: '絵画・観葉・金縁キャビネットの大邸',
  },
  {
    id: 'castle_keep',
    name: '天守風の館',
    price: 150,
    swatch: ['#c8b090', '#4a4540', '#d4af37'],
    ornaments: 'keep',
    desc: '甲冑・旗・畳・3F玉座の天守',
  },
  {
    id: 'osaka',
    name: '大阪城風',
    price: 250,
    swatch: ['#fff8e0', '#2a2420', '#d4af37'],
    ornaments: 'castle',
    desc: '金屏風・柱・朱絨毯・天守玉座',
  },
];

/** Per-skin floor palette overrides (null = use FLOOR_THEMES). */
const SKIN_FLOOR_OVERRIDES = {
  basic: null,
  cottage: [
    {
      floor: '#f2e0b0', floorAlt: '#e6d098', floorGrain: 'rgba(100,70,30,0.14)',
      wall: '#8a6548', wallTop: '#a87858', wallEdge: '#4a3020',
      baseboard: '#5a3a28', door: '#b08040', doorDark: '#785020', doorLight: '#f0d080',
      rug: 'rgba(120,160,80,0.24)', glow: 'rgba(255,230,180,0.12)', badge: '#d0b050',
    },
    {
      floor: '#d0dcc8', floorAlt: '#bcc8b4', floorGrain: 'rgba(50,70,40,0.14)',
      wall: '#5a6a58', wallTop: '#708870', wallEdge: '#303828',
      baseboard: '#3a4438', door: '#6a8860', doorDark: '#405838', doorLight: '#c8e0b8',
      rug: 'rgba(80,130,90,0.22)', glow: 'rgba(180,220,160,0.10)', badge: '#88b878',
    },
    {
      floor: '#f0d0c0', floorAlt: '#e0bcac', floorGrain: 'rgba(110,60,40,0.14)',
      wall: '#8a5a50', wallTop: '#a87068', wallEdge: '#4a2824',
      baseboard: '#5a3830', door: '#a87060', doorDark: '#6a4038', doorLight: '#f0d0c0',
      rug: 'rgba(180,100,80,0.22)', glow: 'rgba(255,200,180,0.10)', badge: '#e0a080',
    },
  ],
  mansion: [
    {
      floor: '#c8b090', floorAlt: '#b89c78', floorGrain: 'rgba(60,40,20,0.2)',
      wall: '#e8e0d0', wallTop: '#f5f0e8', wallEdge: '#6a5848',
      baseboard: '#4a3830', door: '#6a4030', doorDark: '#3a2018', doorLight: '#d4a878',
      rug: 'rgba(140,40,50,0.28)', glow: 'rgba(255,240,220,0.10)', badge: '#c9a227',
    },
    {
      floor: '#b8a888', floorAlt: '#a89878', floorGrain: 'rgba(50,40,25,0.18)',
      wall: '#d8d0c4', wallTop: '#ebe6dc', wallEdge: '#585048',
      baseboard: '#3a3430', door: '#584840', doorDark: '#2a2420', doorLight: '#c8b8a0',
      rug: 'rgba(90,50,100,0.24)', glow: 'rgba(220,210,240,0.08)', badge: '#a898c8',
    },
    {
      floor: '#d0b898', floorAlt: '#c0a888', floorGrain: 'rgba(70,40,30,0.18)',
      wall: '#f0e4d8', wallTop: '#fff8f0', wallEdge: '#7a5048',
      baseboard: '#4a3028', door: '#8a4840', doorDark: '#502820', doorLight: '#e8c0b0',
      rug: 'rgba(160,50,60,0.26)', glow: 'rgba(255,220,200,0.10)', badge: '#d08080',
    },
  ],
  villa: [
    {
      floor: '#e8e4d8', floorAlt: '#d8d4c8', floorGrain: 'rgba(80,70,50,0.12)',
      wall: '#9a9890', wallTop: '#b0aea8', wallEdge: '#4a4840',
      baseboard: '#3a3830', door: '#8a7840', doorDark: '#504820', doorLight: '#e8d080',
      rug: 'rgba(180,150,60,0.22)', glow: 'rgba(255,250,230,0.12)', badge: '#d4af37',
    },
    {
      floor: '#d8e0e8', floorAlt: '#c8d0d8', floorGrain: 'rgba(40,50,70,0.12)',
      wall: '#7a8088', wallTop: '#949aa0', wallEdge: '#3a4048',
      baseboard: '#2a3038', door: '#607088', doorDark: '#384858', doorLight: '#c0d0e0',
      rug: 'rgba(60,100,160,0.22)', glow: 'rgba(200,220,255,0.10)', badge: '#88a8d0',
    },
    {
      floor: '#ece4d0', floorAlt: '#dcd4c0', floorGrain: 'rgba(90,70,40,0.12)',
      wall: '#a09888', wallTop: '#b8b0a0', wallEdge: '#504840',
      baseboard: '#383028', door: '#a08840', doorDark: '#605020', doorLight: '#f0e0a0',
      rug: 'rgba(160,100,40,0.22)', glow: 'rgba(255,240,200,0.10)', badge: '#e0c060',
    },
  ],
  castle_keep: [
    {
      floor: '#c8b090', floorAlt: '#b49c78', floorGrain: 'rgba(50,35,20,0.22)',
      wall: '#5a5548', wallTop: '#706858', wallEdge: '#2a2820',
      baseboard: '#1a1810', door: '#8a7030', doorDark: '#4a3810', doorLight: '#e0c060',
      rug: 'rgba(140,50,40,0.28)', glow: 'rgba(255,210,120,0.08)', badge: '#d4af37',
    },
    {
      floor: '#b0a488', floorAlt: '#9c9074', floorGrain: 'rgba(40,35,25,0.2)',
      wall: '#4a4850', wallTop: '#606068', wallEdge: '#222228',
      baseboard: '#141418', door: '#707888', doorDark: '#384048', doorLight: '#c0c8d8',
      rug: 'rgba(60,70,120,0.26)', glow: 'rgba(160,180,220,0.08)', badge: '#a0b0d0',
    },
    {
      floor: '#d0b070', floorAlt: '#bc9c5c', floorGrain: 'rgba(70,45,15,0.22)',
      wall: '#6a5840', wallTop: '#847058', wallEdge: '#302818',
      baseboard: '#1c1810', door: '#a08030', doorDark: '#584010', doorLight: '#f0d070',
      rug: 'rgba(160,60,40,0.28)', glow: 'rgba(255,200,100,0.10)', badge: '#e8c040',
    },
  ],
  osaka: [
    {
      floor: '#e8d090', floorAlt: '#d4bc70', floorGrain: 'rgba(90,60,15,0.2)',
      wall: '#f5f0e0', wallTop: '#fffaf0', wallEdge: '#c9a227',
      baseboard: '#2a2420', door: '#c9a227', doorDark: '#8a6a12', doorLight: '#ffe08a',
      rug: 'rgba(180,40,40,0.3)', glow: 'rgba(255,220,100,0.14)', badge: '#ffe08a',
    },
    {
      floor: '#d0c080', floorAlt: '#bcac6c', floorGrain: 'rgba(70,55,20,0.18)',
      wall: '#f0e8d0', wallTop: '#fff8e8', wallEdge: '#a88820',
      baseboard: '#282420', door: '#b89830', doorDark: '#6a5810', doorLight: '#f0d870',
      rug: 'rgba(160,50,50,0.28)', glow: 'rgba(255,230,140,0.12)', badge: '#f0d060',
    },
    {
      floor: '#d4a858', floorAlt: '#c09440', floorGrain: 'rgba(100,60,10,0.22)',
      wall: '#fff8e0', wallTop: '#fffef5', wallEdge: '#d4af37',
      baseboard: '#1a1610', door: '#d4af37', doorDark: '#8a6810', doorLight: '#fff0a0',
      rug: 'rgba(200,40,40,0.32)', glow: 'rgba(255,230,120,0.16)', badge: '#ffd040',
    },
  ],
};

export function getHouseSkin(skinId) {
  const id = skinId || 'basic';
  return HOUSE_SKINS.find((s) => s.id === id) || HOUSE_SKINS[0];
}

export function themeForFloor(floor, skinId = 'basic') {
  const fi = Math.max(0, Math.min(FLOORS - 1, floor | 0));
  const base = FLOOR_THEMES[fi];
  const overrides = SKIN_FLOOR_OVERRIDES[skinId || 'basic'];
  if (!overrides || !overrides[fi]) return base;
  return { ...base, ...overrides[fi] };
}

function drawWoodFloor(ctx, px, py, cellSize, x, y, floor = 0, skinId = 'basic') {
  const th = themeForFloor(floor, skinId);
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

function drawWallTile(ctx, px, py, cellSize, floor = 0, skinId = 'basic') {
  const th = themeForFloor(floor, skinId);
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

function drawDoorTile(ctx, px, py, cellSize, floor = 0, skinId = 'basic') {
  const th = themeForFloor(floor, skinId);
  drawWoodFloor(ctx, px, py, cellSize, 0, 0, floor, skinId);
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
function drawStairsTile(ctx, px, py, cellSize, up, floor = 0, skinId = 'basic') {
  const th = themeForFloor(floor, skinId);
  // Landing floor under stairs
  drawWoodFloor(ctx, px, py, cellSize, 1, 1, floor, skinId);

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


/**
 * Deterministic decorative furniture per room (same every match).
 * Drawn inset on FLOOR cells only — does not affect walkability or placement.
 * Skips spawn (6,7) and never draws on doors/stairs/walls.
 * Each skin has 3 floor layouts: 1F living/entrance, 2F bedrooms/study,
 * 3F attic / keep / throne (skin-dependent). Density + signature props
 * make skins visually obvious at a glance.
 */
const FURNITURE_BY_SKIN = {
  // ふつうの家 — sparse everyday; clear 1F living / 2F sleep-study / 3F attic
  basic: [
    // 1F living + entrance
    [
      { x: 5, y: 5, kind: 'coat_rack' },
      { x: 6, y: 1, kind: 'sofa' },
      { x: 7, y: 1, kind: 'tv_stand' },
      { x: 5, y: 3, kind: 'table' },
      { x: 3, y: 1, kind: 'plant' },
      { x: 1, y: 3, kind: 'shelf' },
      { x: 9, y: 3, kind: 'shelf' },
      { x: 11, y: 7, kind: 'plant' },
    ],
    // 2F bedrooms + study
    [
      { x: 1, y: 1, kind: 'bed' },
      { x: 1, y: 3, kind: 'shelf' },
      { x: 3, y: 1, kind: 'plant' },
      { x: 5, y: 1, kind: 'desk' },
      { x: 6, y: 1, kind: 'chair' },
      { x: 7, y: 3, kind: 'shelf' },
      { x: 9, y: 6, kind: 'bed' },
      { x: 11, y: 5, kind: 'shelf' },
      { x: 10, y: 3, kind: 'table' },
      { x: 3, y: 5, kind: 'plant' },
    ],
    // 3F attic storage
    [
      { x: 1, y: 1, kind: 'crate' },
      { x: 3, y: 1, kind: 'trunk' },
      { x: 2, y: 3, kind: 'crate' },
      { x: 5, y: 3, kind: 'shelf' },
      { x: 7, y: 1, kind: 'trunk' },
      { x: 9, y: 1, kind: 'crate' },
      { x: 11, y: 3, kind: 'trunk' },
      { x: 1, y: 5, kind: 'crate' },
      { x: 3, y: 6, kind: 'plant' },
      { x: 9, y: 6, kind: 'trunk' },
      { x: 11, y: 5, kind: 'crate' },
    ],
  ],
  // こざっぱり — warm wood, curtains, cozy rugs; kitchen-ish 1F
  cottage: [
    // 1F living + kitchen nook
    [
      { x: 1, y: 1, kind: 'curtain' },
      { x: 3, y: 1, kind: 'stove' },
      { x: 1, y: 3, kind: 'dresser' },
      { x: 2, y: 2, kind: 'rug_cozy' },
      { x: 6, y: 1, kind: 'sofa' },
      { x: 5, y: 3, kind: 'table_wood' },
      { x: 7, y: 3, kind: 'plant' },
      { x: 6, y: 2, kind: 'rug_cozy' },
      { x: 9, y: 1, kind: 'curtain' },
      { x: 11, y: 3, kind: 'shelf_wood' },
      { x: 10, y: 2, kind: 'rug_cozy' },
      { x: 5, y: 5, kind: 'coat_rack' },
      { x: 3, y: 5, kind: 'dresser' },
      { x: 1, y: 5, kind: 'plant' },
      { x: 2, y: 6, kind: 'table_wood' },
      { x: 9, y: 6, kind: 'shelf_wood' },
      { x: 11, y: 7, kind: 'plant' },
      { x: 10, y: 6, kind: 'rug_cozy' },
    ],
    // 2F bedrooms
    [
      { x: 1, y: 1, kind: 'bed_nice' },
      { x: 3, y: 1, kind: 'curtain' },
      { x: 1, y: 3, kind: 'dresser' },
      { x: 2, y: 2, kind: 'rug_cozy' },
      { x: 5, y: 1, kind: 'desk' },
      { x: 6, y: 1, kind: 'chair' },
      { x: 7, y: 3, kind: 'plant' },
      { x: 6, y: 2, kind: 'rug_cozy' },
      { x: 9, y: 1, kind: 'bed_nice' },
      { x: 11, y: 3, kind: 'dresser' },
      { x: 10, y: 2, kind: 'curtain' },
      { x: 3, y: 5, kind: 'wardrobe' },
      { x: 1, y: 5, kind: 'plant' },
      { x: 2, y: 6, kind: 'rug_cozy' },
      { x: 7, y: 5, kind: 'shelf_wood' },
      { x: 9, y: 6, kind: 'bed_nice' },
      { x: 11, y: 5, kind: 'dresser' },
      { x: 11, y: 7, kind: 'curtain' },
      { x: 10, y: 6, kind: 'rug_cozy' },
    ],
    // 3F cozy attic loft
    [
      { x: 1, y: 1, kind: 'trunk' },
      { x: 3, y: 1, kind: 'curtain' },
      { x: 2, y: 2, kind: 'rug_cozy' },
      { x: 1, y: 3, kind: 'crate' },
      { x: 5, y: 1, kind: 'bed_nice' },
      { x: 7, y: 1, kind: 'curtain' },
      { x: 6, y: 2, kind: 'rug_cozy' },
      { x: 5, y: 3, kind: 'table_wood' },
      { x: 9, y: 1, kind: 'trunk' },
      { x: 11, y: 3, kind: 'plant' },
      { x: 10, y: 2, kind: 'rug_cozy' },
      { x: 3, y: 5, kind: 'dresser' },
      { x: 1, y: 5, kind: 'crate' },
      { x: 2, y: 6, kind: 'rug_cozy' },
      { x: 7, y: 5, kind: 'shelf_wood' },
      { x: 9, y: 6, kind: 'trunk' },
      { x: 11, y: 5, kind: 'curtain' },
      { x: 11, y: 7, kind: 'plant' },
      { x: 5, y: 6, kind: 'plant' },
    ],
  ],
  // 洋館 — parlor / library-bedrooms / gallery; fireplace + chandelier signature
  mansion: [
    // 1F parlor + entrance hall
    [
      { x: 1, y: 1, kind: 'bookshelf' },
      { x: 3, y: 1, kind: 'plant' },
      { x: 1, y: 3, kind: 'fireplace' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 6, y: 1, kind: 'sofa' },
      { x: 5, y: 3, kind: 'table_elegant' },
      { x: 7, y: 1, kind: 'fireplace' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 7, y: 3, kind: 'plant' },
      { x: 9, y: 1, kind: 'bookshelf' },
      { x: 10, y: 3, kind: 'table_elegant' },
      { x: 11, y: 3, kind: 'plant' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 5, y: 5, kind: 'coat_rack' },
      { x: 3, y: 5, kind: 'bookshelf' },
      { x: 1, y: 5, kind: 'fireplace' },
      { x: 2, y: 6, kind: 'table_elegant' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 9, y: 5, kind: 'sofa' },
      { x: 11, y: 7, kind: 'plant' },
      { x: 10, y: 6, kind: 'chandelier' },
    ],
    // 2F bedrooms + study library
    [
      { x: 1, y: 1, kind: 'bed_nice' },
      { x: 3, y: 1, kind: 'plant' },
      { x: 1, y: 3, kind: 'bookshelf' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 5, y: 1, kind: 'desk' },
      { x: 6, y: 1, kind: 'chair' },
      { x: 7, y: 3, kind: 'bookshelf' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 5, y: 3, kind: 'table_elegant' },
      { x: 9, y: 1, kind: 'bed_nice' },
      { x: 11, y: 3, kind: 'bookshelf' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 9, y: 3, kind: 'fireplace' },
      { x: 1, y: 5, kind: 'fireplace' },
      { x: 3, y: 5, kind: 'bookshelf' },
      { x: 2, y: 6, kind: 'wardrobe' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 7, y: 5, kind: 'bookshelf' },
      { x: 5, y: 5, kind: 'plant' },
      { x: 9, y: 6, kind: 'bed_nice' },
      { x: 11, y: 5, kind: 'bookshelf' },
      { x: 11, y: 7, kind: 'plant' },
      { x: 10, y: 6, kind: 'chandelier' },
    ],
    // 3F gallery attic
    [
      { x: 1, y: 1, kind: 'art_frame' },
      { x: 3, y: 1, kind: 'bookshelf' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 1, y: 3, kind: 'fireplace' },
      { x: 5, y: 1, kind: 'sofa' },
      { x: 7, y: 1, kind: 'art_frame' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 5, y: 3, kind: 'table_elegant' },
      { x: 9, y: 1, kind: 'art_frame' },
      { x: 11, y: 3, kind: 'bookshelf' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 9, y: 3, kind: 'plant' },
      { x: 1, y: 5, kind: 'art_frame' },
      { x: 3, y: 5, kind: 'bookshelf' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 2, y: 6, kind: 'table_elegant' },
      { x: 5, y: 5, kind: 'plant' },
      { x: 7, y: 5, kind: 'art_frame' },
      { x: 9, y: 5, kind: 'fireplace' },
      { x: 11, y: 5, kind: 'bookshelf' },
      { x: 10, y: 6, kind: 'chandelier' },
      { x: 11, y: 7, kind: 'plant' },
      { x: 9, y: 6, kind: 'sofa' },
    ],
  ],
  // 大邸宅 — dense luxury; tall plants, art, ornate cabinets, grand tables
  villa: [
    // 1F grand foyer / salon
    [
      { x: 1, y: 1, kind: 'cabinet_ornate' },
      { x: 3, y: 1, kind: 'art_frame' },
      { x: 1, y: 3, kind: 'plant_tall' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 3, y: 3, kind: 'plant_tall' },
      { x: 6, y: 1, kind: 'sofa' },
      { x: 5, y: 3, kind: 'table_grand' },
      { x: 7, y: 3, kind: 'plant_tall' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 7, y: 1, kind: 'art_frame' },
      { x: 9, y: 1, kind: 'cabinet_ornate' },
      { x: 10, y: 3, kind: 'table_grand' },
      { x: 11, y: 3, kind: 'art_frame' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 9, y: 3, kind: 'plant_tall' },
      { x: 5, y: 5, kind: 'coat_rack' },
      { x: 1, y: 5, kind: 'art_frame' },
      { x: 3, y: 5, kind: 'cabinet_ornate' },
      { x: 2, y: 6, kind: 'table_grand' },
      { x: 1, y: 6, kind: 'plant_tall' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 7, y: 5, kind: 'plant_tall' },
      { x: 9, y: 5, kind: 'sofa' },
      { x: 11, y: 5, kind: 'cabinet_ornate' },
      { x: 10, y: 6, kind: 'chandelier' },
      { x: 11, y: 7, kind: 'plant_tall' },
      { x: 10, y: 5, kind: 'art_frame' },
    ],
    // 2F luxury suites + study
    [
      { x: 1, y: 1, kind: 'bed_luxury' },
      { x: 3, y: 1, kind: 'art_frame' },
      { x: 1, y: 3, kind: 'wardrobe' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 3, y: 3, kind: 'plant_tall' },
      { x: 5, y: 1, kind: 'desk' },
      { x: 6, y: 1, kind: 'chair' },
      { x: 7, y: 3, kind: 'cabinet_ornate' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 5, y: 3, kind: 'table_grand' },
      { x: 7, y: 1, kind: 'art_frame' },
      { x: 9, y: 1, kind: 'bed_luxury' },
      { x: 11, y: 3, kind: 'wardrobe' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 9, y: 3, kind: 'plant_tall' },
      { x: 10, y: 3, kind: 'cabinet_ornate' },
      { x: 1, y: 5, kind: 'art_frame' },
      { x: 3, y: 5, kind: 'cabinet_ornate' },
      { x: 2, y: 6, kind: 'wardrobe' },
      { x: 1, y: 6, kind: 'plant_tall' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 5, y: 5, kind: 'plant_tall' },
      { x: 7, y: 5, kind: 'art_frame' },
      { x: 5, y: 6, kind: 'table_grand' },
      { x: 9, y: 6, kind: 'bed_luxury' },
      { x: 11, y: 5, kind: 'cabinet_ornate' },
      { x: 11, y: 7, kind: 'plant_tall' },
      { x: 10, y: 5, kind: 'art_frame' },
      { x: 10, y: 6, kind: 'chandelier' },
    ],
    // 3F upper lounge / gallery
    [
      { x: 1, y: 1, kind: 'art_frame' },
      { x: 3, y: 1, kind: 'cabinet_ornate' },
      { x: 2, y: 2, kind: 'chandelier' },
      { x: 1, y: 3, kind: 'plant_tall' },
      { x: 3, y: 3, kind: 'sofa' },
      { x: 5, y: 1, kind: 'table_grand' },
      { x: 7, y: 1, kind: 'art_frame' },
      { x: 6, y: 2, kind: 'chandelier' },
      { x: 5, y: 3, kind: 'plant_tall' },
      { x: 7, y: 3, kind: 'cabinet_ornate' },
      { x: 9, y: 1, kind: 'art_frame' },
      { x: 11, y: 3, kind: 'plant_tall' },
      { x: 10, y: 2, kind: 'chandelier' },
      { x: 9, y: 3, kind: 'sofa' },
      { x: 10, y: 3, kind: 'table_grand' },
      { x: 1, y: 5, kind: 'art_frame' },
      { x: 3, y: 5, kind: 'cabinet_ornate' },
      { x: 2, y: 5, kind: 'chandelier' },
      { x: 2, y: 6, kind: 'plant_tall' },
      { x: 5, y: 5, kind: 'sofa' },
      { x: 7, y: 5, kind: 'art_frame' },
      { x: 5, y: 6, kind: 'table_grand' },
      { x: 6, y: 5, kind: 'chandelier' },
      { x: 9, y: 5, kind: 'cabinet_ornate' },
      { x: 11, y: 5, kind: 'art_frame' },
      { x: 10, y: 6, kind: 'chandelier' },
      { x: 11, y: 7, kind: 'plant_tall' },
      { x: 9, y: 6, kind: 'plant_tall' },
    ],
  ],
  // 天守風 — armor/banner/lantern/tatami; 3F throne keep
  castle_keep: [
    // 1F gate hall / barracks feel
    [
      { x: 1, y: 1, kind: 'armor' },
      { x: 3, y: 1, kind: 'banner' },
      { x: 1, y: 3, kind: 'chest_deco' },
      { x: 2, y: 2, kind: 'tatami' },
      { x: 3, y: 3, kind: 'lantern' },
      { x: 6, y: 1, kind: 'banner' },
      { x: 5, y: 3, kind: 'chest_deco' },
      { x: 7, y: 3, kind: 'lantern' },
      { x: 6, y: 2, kind: 'tatami' },
      { x: 7, y: 1, kind: 'armor' },
      { x: 9, y: 1, kind: 'banner' },
      { x: 10, y: 3, kind: 'chest_deco' },
      { x: 11, y: 3, kind: 'lantern' },
      { x: 10, y: 2, kind: 'tatami' },
      { x: 9, y: 3, kind: 'armor' },
      { x: 5, y: 5, kind: 'banner' },
      { x: 3, y: 5, kind: 'chest_deco' },
      { x: 1, y: 5, kind: 'armor' },
      { x: 2, y: 6, kind: 'tatami' },
      { x: 3, y: 6, kind: 'lantern' },
      { x: 7, y: 5, kind: 'lantern' },
      { x: 5, y: 6, kind: 'tatami' },
      { x: 11, y: 5, kind: 'armor' },
      { x: 9, y: 6, kind: 'chest_deco' },
      { x: 11, y: 7, kind: 'lantern' },
      { x: 10, y: 5, kind: 'banner' },
      { x: 10, y: 6, kind: 'tatami' },
    ],
    // 2F warrior quarters
    [
      { x: 1, y: 1, kind: 'armor' },
      { x: 3, y: 1, kind: 'banner' },
      { x: 1, y: 3, kind: 'chest_deco' },
      { x: 2, y: 2, kind: 'tatami' },
      { x: 3, y: 3, kind: 'lantern' },
      { x: 5, y: 1, kind: 'banner' },
      { x: 7, y: 1, kind: 'armor' },
      { x: 6, y: 2, kind: 'tatami' },
      { x: 5, y: 3, kind: 'chest_deco' },
      { x: 7, y: 3, kind: 'lantern' },
      { x: 9, y: 1, kind: 'armor' },
      { x: 11, y: 3, kind: 'banner' },
      { x: 10, y: 2, kind: 'tatami' },
      { x: 9, y: 3, kind: 'lantern' },
      { x: 10, y: 3, kind: 'chest_deco' },
      { x: 1, y: 5, kind: 'banner' },
      { x: 3, y: 5, kind: 'armor' },
      { x: 2, y: 6, kind: 'tatami' },
      { x: 2, y: 5, kind: 'lantern' },
      { x: 3, y: 6, kind: 'chest_deco' },
      { x: 5, y: 5, kind: 'lantern' },
      { x: 7, y: 5, kind: 'banner' },
      { x: 5, y: 6, kind: 'tatami' },
      { x: 9, y: 5, kind: 'armor' },
      { x: 11, y: 5, kind: 'banner' },
      { x: 10, y: 6, kind: 'tatami' },
      { x: 9, y: 6, kind: 'chest_deco' },
      { x: 11, y: 7, kind: 'lantern' },
    ],
    // 3F keep throne hall
    [
      { x: 1, y: 1, kind: 'armor' },
      { x: 3, y: 1, kind: 'banner' },
      { x: 2, y: 2, kind: 'tatami' },
      { x: 1, y: 3, kind: 'lantern' },
      { x: 3, y: 3, kind: 'chest_deco' },
      { x: 6, y: 1, kind: 'throne' },
      { x: 5, y: 1, kind: 'banner' },
      { x: 7, y: 1, kind: 'banner' },
      { x: 5, y: 3, kind: 'armor' },
      { x: 7, y: 3, kind: 'armor' },
      { x: 6, y: 2, kind: 'tatami' },
      { x: 6, y: 3, kind: 'lantern' },
      { x: 9, y: 1, kind: 'banner' },
      { x: 11, y: 3, kind: 'armor' },
      { x: 10, y: 2, kind: 'tatami' },
      { x: 9, y: 3, kind: 'lantern' },
      { x: 10, y: 3, kind: 'chest_deco' },
      { x: 1, y: 5, kind: 'banner' },
      { x: 3, y: 5, kind: 'armor' },
      { x: 2, y: 6, kind: 'tatami' },
      { x: 2, y: 5, kind: 'lantern' },
      { x: 5, y: 5, kind: 'chest_deco' },
      { x: 7, y: 5, kind: 'banner' },
      { x: 5, y: 6, kind: 'tatami' },
      { x: 7, y: 6, kind: 'lantern' },
      { x: 9, y: 5, kind: 'armor' },
      { x: 11, y: 5, kind: 'banner' },
      { x: 10, y: 6, kind: 'tatami' },
      { x: 9, y: 6, kind: 'chest_deco' },
      { x: 11, y: 7, kind: 'lantern' },
    ],
  ],
  // 大阪城風 — densest; gold screens, pillars, byobu; 3F tenshu throne
  osaka: [
    // 1F reception hall
    [
      { x: 1, y: 1, kind: 'byobu' },
      { x: 3, y: 1, kind: 'gold_screen' },
      { x: 2, y: 1, kind: 'pillar' },
      { x: 1, y: 3, kind: 'ornate_chest' },
      { x: 2, y: 2, kind: 'rug_rich' },
      { x: 3, y: 3, kind: 'castle_lantern' },
      { x: 6, y: 1, kind: 'gold_screen' },
      { x: 5, y: 1, kind: 'pillar' },
      { x: 7, y: 1, kind: 'byobu' },
      { x: 5, y: 3, kind: 'ornate_chest' },
      { x: 7, y: 3, kind: 'castle_lantern' },
      { x: 6, y: 2, kind: 'rug_rich' },
      { x: 9, y: 1, kind: 'gold_screen' },
      { x: 11, y: 2, kind: 'pillar' },
      { x: 10, y: 3, kind: 'ornate_chest' },
      { x: 11, y: 3, kind: 'castle_lantern' },
      { x: 10, y: 2, kind: 'rug_rich' },
      { x: 9, y: 3, kind: 'byobu' },
      { x: 5, y: 5, kind: 'pillar' },
      { x: 1, y: 5, kind: 'gold_screen' },
      { x: 3, y: 5, kind: 'ornate_chest' },
      { x: 2, y: 6, kind: 'rug_rich' },
      { x: 1, y: 6, kind: 'castle_lantern' },
      { x: 3, y: 6, kind: 'pillar' },
      { x: 2, y: 5, kind: 'byobu' },
      { x: 7, y: 5, kind: 'gold_screen' },
      { x: 5, y: 6, kind: 'rug_rich' },
      { x: 7, y: 6, kind: 'castle_lantern' },
      { x: 11, y: 5, kind: 'ornate_chest' },
      { x: 9, y: 6, kind: 'byobu' },
      { x: 11, y: 7, kind: 'castle_lantern' },
      { x: 10, y: 5, kind: 'gold_screen' },
      { x: 10, y: 6, kind: 'rug_rich' },
      { x: 9, y: 5, kind: 'pillar' },
    ],
    // 2F chambers
    [
      { x: 1, y: 1, kind: 'byobu' },
      { x: 3, y: 1, kind: 'gold_screen' },
      { x: 2, y: 1, kind: 'pillar' },
      { x: 1, y: 3, kind: 'ornate_chest' },
      { x: 2, y: 2, kind: 'rug_rich' },
      { x: 3, y: 3, kind: 'castle_lantern' },
      { x: 5, y: 1, kind: 'gold_screen' },
      { x: 7, y: 1, kind: 'byobu' },
      { x: 6, y: 1, kind: 'pillar' },
      { x: 5, y: 3, kind: 'ornate_chest' },
      { x: 7, y: 3, kind: 'castle_lantern' },
      { x: 6, y: 2, kind: 'rug_rich' },
      { x: 9, y: 1, kind: 'byobu' },
      { x: 11, y: 3, kind: 'gold_screen' },
      { x: 11, y: 2, kind: 'pillar' },
      { x: 10, y: 2, kind: 'rug_rich' },
      { x: 9, y: 3, kind: 'ornate_chest' },
      { x: 10, y: 3, kind: 'castle_lantern' },
      { x: 1, y: 5, kind: 'gold_screen' },
      { x: 3, y: 5, kind: 'byobu' },
      { x: 2, y: 5, kind: 'pillar' },
      { x: 2, y: 6, kind: 'rug_rich' },
      { x: 1, y: 6, kind: 'castle_lantern' },
      { x: 3, y: 6, kind: 'ornate_chest' },
      { x: 5, y: 5, kind: 'castle_lantern' },
      { x: 7, y: 5, kind: 'gold_screen' },
      { x: 5, y: 6, kind: 'rug_rich' },
      { x: 7, y: 6, kind: 'pillar' },
      { x: 9, y: 5, kind: 'byobu' },
      { x: 11, y: 5, kind: 'ornate_chest' },
      { x: 10, y: 5, kind: 'pillar' },
      { x: 10, y: 6, kind: 'rug_rich' },
      { x: 9, y: 6, kind: 'gold_screen' },
      { x: 11, y: 7, kind: 'castle_lantern' },
      { x: 11, y: 6, kind: 'ornate_chest' },
    ],
    // 3F tenshu throne hall — densest gold
    [
      { x: 1, y: 1, kind: 'byobu' },
      { x: 3, y: 1, kind: 'gold_screen' },
      { x: 2, y: 1, kind: 'pillar' },
      { x: 1, y: 3, kind: 'castle_lantern' },
      { x: 2, y: 2, kind: 'rug_rich' },
      { x: 3, y: 3, kind: 'ornate_chest' },
      { x: 6, y: 1, kind: 'throne' },
      { x: 5, y: 1, kind: 'pillar' },
      { x: 7, y: 1, kind: 'pillar' },
      { x: 5, y: 3, kind: 'gold_screen' },
      { x: 7, y: 3, kind: 'byobu' },
      { x: 6, y: 2, kind: 'rug_rich' },
      { x: 6, y: 3, kind: 'castle_lantern' },
      { x: 9, y: 1, kind: 'gold_screen' },
      { x: 11, y: 2, kind: 'pillar' },
      { x: 10, y: 2, kind: 'rug_rich' },
      { x: 9, y: 3, kind: 'byobu' },
      { x: 11, y: 3, kind: 'castle_lantern' },
      { x: 10, y: 3, kind: 'ornate_chest' },
      { x: 1, y: 5, kind: 'gold_screen' },
      { x: 3, y: 5, kind: 'byobu' },
      { x: 2, y: 5, kind: 'pillar' },
      { x: 2, y: 6, kind: 'rug_rich' },
      { x: 1, y: 6, kind: 'castle_lantern' },
      { x: 3, y: 6, kind: 'ornate_chest' },
      { x: 5, y: 5, kind: 'castle_lantern' },
      { x: 7, y: 5, kind: 'gold_screen' },
      { x: 5, y: 6, kind: 'rug_rich' },
      { x: 7, y: 6, kind: 'pillar' },
      { x: 6, y: 5, kind: 'ornate_chest' },
      { x: 9, y: 5, kind: 'pillar' },
      { x: 11, y: 5, kind: 'ornate_chest' },
      { x: 10, y: 5, kind: 'gold_screen' },
      { x: 10, y: 6, kind: 'rug_rich' },
      { x: 9, y: 6, kind: 'byobu' },
      { x: 11, y: 7, kind: 'castle_lantern' },
      { x: 11, y: 6, kind: 'ornate_chest' },
    ],
  ],
};

function furnitureLayoutForSkin(skinId, floor = 0) {
  const bySkin = FURNITURE_BY_SKIN[skinId] || FURNITURE_BY_SKIN.basic;
  const fi = Math.max(0, Math.min(FLOORS - 1, floor | 0));
  // Per-floor layouts: [f0, f1, f2]
  if (Array.isArray(bySkin[0])) return bySkin[fi] || bySkin[0] || [];
  return bySkin;
}

function drawRoomFurniture(ctx, blueprint, floor, ox, oy, cellSize, skinId = 'basic') {
  const layout = furnitureLayoutForSkin(skinId, floor);
  // Draw floor-ish mats/rugs first so upright props sit on top
  const order = (k) => (
    k === 'tatami' || k === 'rug_cozy' || k === 'rug_rich' ? 0 : 1
  );
  const sorted = layout.slice().sort((a, b) => order(a.kind) - order(b.kind));
  for (const item of sorted) {
    const { x, y, kind } = item;
    if (blueprint[floor][y][x] !== T.FLOOR) continue;
    if (x === 6 && y === 7) continue;
    const px = ox + x * cellSize;
    const py = oy + y * cellSize;
    drawFurnitureSprite(ctx, kind, px, py, cellSize, floor, skinId);
  }
}

function drawFurnitureSprite(ctx, kind, px, py, cellSize, floor, skinId = 'basic') {
  const th = themeForFloor(floor, skinId);
  const s = cellSize;
  const m = s * 0.14;
  const gold = th.badge || '#d4af37';
  const wood = shadeColor(th.wallEdge, 25);
  const woodHi = shadeColor(th.doorLight, -20);
  const woodDk = th.wallEdge;

  // --- beds ---
  if (kind === 'bed' || kind === 'bed_nice' || kind === 'bed_luxury') {
    const frame = kind === 'bed_luxury' ? gold : kind === 'bed_nice' ? wood : shadeColor(th.wallEdge, 20);
    ctx.fillStyle = frame;
    ctx.fillRect(px + m, py + m * 1.2, s - m * 2, s - m * 2.2);
    const mattress = kind === 'bed_luxury'
      ? (floor === 1 ? '#e8e0f0' : floor === 2 ? '#f8d8e0' : '#fff4d8')
      : kind === 'bed_nice'
        ? (floor === 1 ? '#d0dcc8' : floor === 2 ? '#f0d0c0' : '#f5e8c8')
        : (floor === 1 ? '#c8d4e8' : floor === 2 ? '#f0c8d0' : '#f0e0c0');
    ctx.fillStyle = mattress;
    ctx.fillRect(px + m + 2, py + m * 1.2 + 2, s - m * 2 - 4, s - m * 2.2 - 4);
    ctx.fillStyle = '#fff8ee';
    ctx.fillRect(px + m + 3, py + m * 1.2 + 3, s * 0.28, s * 0.18);
    if (kind === 'bed_luxury') {
      ctx.fillStyle = gold;
      ctx.fillRect(px + m, py + m * 1.2, s - m * 2, 2);
      ctx.fillRect(px + m + 2, py + s * 0.50, s - m * 2 - 4, s * 0.14);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(px + m + 4, py + s * 0.52, s - m * 2 - 8, 2);
    } else {
      ctx.fillStyle = th.rug.replace(/0\.\d+/g, '0.45');
      ctx.fillRect(px + m + 2, py + s * 0.52, s - m * 2 - 4, s * 0.12);
      if (kind === 'bed_nice') {
        ctx.fillStyle = woodHi;
        ctx.fillRect(px + m, py + m * 1.2, s - m * 2, 2);
      }
    }
    return;
  }

  // --- tables ---
  if (kind === 'table' || kind === 'table_wood' || kind === 'table_elegant' || kind === 'table_grand') {
    const topH = kind === 'table' ? s * 0.36 : s * 0.42;
    const topY = py + m * (kind === 'table' ? 1.6 : 1.3);
    ctx.fillStyle = kind === 'table_grand' || kind === 'table_elegant' ? woodDk : wood;
    ctx.fillRect(px + m, topY, s - m * 2, topH);
    ctx.fillStyle = kind === 'table_grand' ? gold : kind === 'table_elegant' ? woodHi : shadeColor(th.doorLight, -40);
    ctx.fillRect(px + m + 2, topY + 2, s - m * 2 - 4, topH - 6);
    if (kind === 'table_elegant' || kind === 'table_grand') {
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + m + 3, topY + 3, s - m * 2 - 6, topH - 8);
    }
    if (kind === 'table_grand') {
      // Center runner
      ctx.fillStyle = th.rug.replace(/0\.\d+/g, '0.5');
      ctx.fillRect(px + s * 0.38, topY + 4, s * 0.24, topH - 10);
    }
    ctx.fillStyle = woodDk;
    const legW = Math.max(2, s * 0.06);
    const legY = topY + topH;
    const legH = s * (kind === 'table' ? 0.18 : 0.22);
    ctx.fillRect(px + m + 2, legY, legW, legH);
    ctx.fillRect(px + s - m - 2 - legW, legY, legW, legH);
    if (kind === 'table_grand') {
      ctx.fillRect(px + m + 2 + legW * 3, legY, legW, legH);
      ctx.fillRect(px + s - m - 2 - legW * 4, legY, legW, legH);
    }
    return;
  }

  // --- sofa ---
  if (kind === 'sofa') {
    ctx.fillStyle = shadeColor(th.wall, 10);
    ctx.fillRect(px + m * 0.8, py + m, s - m * 1.6, s * 0.28);
    const seat = skinId === 'villa'
      ? (floor === 1 ? '#6a7088' : floor === 2 ? '#a88840' : '#8a7860')
      : skinId === 'mansion'
        ? (floor === 1 ? '#5a4060' : floor === 2 ? '#8a3040' : '#704030')
        : skinId === 'cottage'
          ? (floor === 1 ? '#6a8860' : floor === 2 ? '#a87060' : '#a07040')
          : (floor === 1 ? '#5a7aaa' : floor === 2 ? '#b06070' : '#a05040');
    ctx.fillStyle = seat;
    ctx.fillRect(px + m * 0.8, py + m + s * 0.22, s - m * 1.6, s * 0.38);
    ctx.fillStyle = shadeColor(seat, -25);
    ctx.fillRect(px + m * 0.8, py + m + s * 0.18, s * 0.12, s * 0.42);
    ctx.fillRect(px + s - m * 0.8 - s * 0.12, py + m + s * 0.18, s * 0.12, s * 0.42);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px + m + s * 0.14, py + m + s * 0.28, s * 0.5, s * 0.1);
    if (skinId === 'mansion' || skinId === 'villa') {
      ctx.fillStyle = gold;
      ctx.fillRect(px + m * 0.8, py + m, s - m * 1.6, 2);
    }
    return;
  }

  // --- shelves / cabinets / bookshelf / dresser / wardrobe ---
  if (kind === 'shelf' || kind === 'shelf_wood' || kind === 'bookshelf' || kind === 'dresser' || kind === 'cabinet_ornate' || kind === 'wardrobe') {
    const bodyX = px + m * 1.2;
    const bodyY = py + m * 0.8;
    const bodyW = s - m * 2.4;
    const bodyH = s - m * 1.6;
    ctx.fillStyle = kind === 'cabinet_ornate' ? gold : woodDk;
    ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
    ctx.fillStyle = kind === 'cabinet_ornate'
      ? shadeColor(th.wall, 25)
      : kind === 'dresser' || kind === 'shelf_wood' || kind === 'wardrobe'
        ? woodHi
        : shadeColor(th.wall, 15);
    ctx.fillRect(bodyX + 1, bodyY + 1, bodyW - 2, bodyH - 2);
    if (kind === 'dresser') {
      // Drawers
      for (let d = 0; d < 2; d++) {
        const dy = bodyY + 4 + d * (bodyH * 0.42);
        ctx.fillStyle = wood;
        ctx.fillRect(bodyX + 3, dy, bodyW - 6, bodyH * 0.36);
        ctx.fillStyle = gold;
        ctx.fillRect(bodyX + bodyW * 0.5 - 2, dy + bodyH * 0.14, 4, 3);
      }
      return;
    }
    if (kind === 'wardrobe') {
      ctx.fillStyle = wood;
      ctx.fillRect(bodyX + 3, bodyY + 3, bodyW * 0.42, bodyH - 6);
      ctx.fillRect(bodyX + bodyW * 0.52, bodyY + 3, bodyW * 0.42, bodyH - 6);
      ctx.fillStyle = gold;
      ctx.fillRect(bodyX + bodyW * 0.38, bodyY + bodyH * 0.45, 3, 4);
      ctx.fillRect(bodyX + bodyW * 0.58, bodyY + bodyH * 0.45, 3, 4);
      ctx.fillStyle = woodDk;
      ctx.fillRect(bodyX + 3, bodyY + bodyH * 0.72, bodyW - 6, 2);
      return;
    }
    if (kind === 'cabinet_ornate') {
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1;
      ctx.strokeRect(bodyX + 3, bodyY + 3, bodyW - 6, bodyH - 6);
      ctx.fillStyle = gold;
      ctx.fillRect(bodyX + bodyW * 0.5 - 1, bodyY + 4, 2, bodyH - 8);
      ctx.fillStyle = '#c04040';
      ctx.beginPath();
      ctx.arc(bodyX + bodyW * 0.28, bodyY + bodyH * 0.5, 2, 0, Math.PI * 2);
      ctx.arc(bodyX + bodyW * 0.72, bodyY + bodyH * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const books = kind === 'bookshelf'
      ? ['#6a2030', '#2a4060', '#8a7020', '#2a5840', '#503070', '#a05030']
      : ['#c04040', '#4060b0', '#d0a020', '#408060', '#8040a0'];
    const rows = kind === 'bookshelf' ? 4 : 3;
    const innerX = bodyX + 3;
    const innerW = bodyW - 6;
    for (let r = 0; r < rows; r++) {
      const by = bodyY + 4 + r * ((bodyH - 8) / rows);
      ctx.fillStyle = woodDk;
      ctx.fillRect(innerX - 1, by + s * 0.14, innerW + 2, 2);
      let bx = innerX;
      const n = kind === 'bookshelf' ? 5 : 4;
      for (let b = 0; b < n; b++) {
        const bw = innerW / n - 1;
        ctx.fillStyle = books[(r * 3 + b + floor) % books.length];
        ctx.fillRect(bx, by, bw, s * 0.13);
        bx += bw + 1;
      }
    }
    return;
  }

  // --- plants ---
  if (kind === 'plant' || kind === 'plant_tall') {
    const potY = kind === 'plant_tall' ? s * 0.62 : s * 0.58;
    ctx.fillStyle = skinId === 'villa' ? '#6a5a48' : '#8a5a3c';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.32, py + potY);
    ctx.lineTo(px + s * 0.68, py + potY);
    ctx.lineTo(px + s * 0.62, py + s * 0.82);
    ctx.lineTo(px + s * 0.38, py + s * 0.82);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6a4028';
    ctx.fillRect(px + s * 0.30, py + potY - s * 0.04, s * 0.40, s * 0.06);
    if (kind === 'plant_tall') {
      ctx.fillStyle = '#2d6b3a';
      ctx.fillRect(px + s * 0.47, py + s * 0.18, s * 0.06, s * 0.44);
      ctx.fillStyle = '#3d8b4a';
      ctx.beginPath();
      ctx.ellipse(px + s * 0.38, py + s * 0.28, s * 0.14, s * 0.22, -0.4, 0, Math.PI * 2);
      ctx.ellipse(px + s * 0.62, py + s * 0.26, s * 0.14, s * 0.24, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5cb86a';
      ctx.beginPath();
      ctx.ellipse(px + s * 0.5, py + s * 0.18, s * 0.12, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#3d8b4a';
      ctx.beginPath();
      ctx.arc(px + s * 0.5, py + s * 0.38, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5cb86a';
      ctx.beginPath();
      ctx.arc(px + s * 0.38, py + s * 0.42, s * 0.12, 0, Math.PI * 2);
      ctx.arc(px + s * 0.62, py + s * 0.40, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  // --- cottage curtain hint ---
  if (kind === 'curtain') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(px + m, py + m * 0.5, s - m * 2, 3);
    const cloth = floor === 1 ? '#88a878' : floor === 2 ? '#d09080' : '#d0b050';
    ctx.fillStyle = cloth;
    ctx.fillRect(px + m, py + m * 0.5 + 3, s * 0.28, s * 0.55);
    ctx.fillRect(px + s - m - s * 0.28, py + m * 0.5 + 3, s * 0.28, s * 0.55);
    ctx.fillStyle = shadeColor(cloth, 30);
    ctx.fillRect(px + m + 2, py + m * 0.5 + 5, s * 0.1, s * 0.5);
    ctx.fillRect(px + s - m - s * 0.18, py + m * 0.5 + 5, s * 0.1, s * 0.5);
    return;
  }

  // --- rugs / tatami ---
  if (kind === 'rug_cozy' || kind === 'rug_rich' || kind === 'tatami') {
    const pad = s * 0.12;
    if (kind === 'tatami') {
      ctx.fillStyle = '#c8b86a';
      ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
      ctx.fillStyle = '#a89848';
      ctx.fillRect(px + pad, py + pad, s - pad * 2, 2);
      ctx.fillRect(px + pad, py + s - pad - 2, s - pad * 2, 2);
      ctx.strokeStyle = 'rgba(80,60,20,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.5, py + pad + 2);
      ctx.lineTo(px + s * 0.5, py + s - pad - 2);
      ctx.stroke();
      ctx.fillStyle = '#8a7830';
      ctx.fillRect(px + pad, py + pad, 3, s - pad * 2);
      ctx.fillRect(px + s - pad - 3, py + pad, 3, s - pad * 2);
    } else if (kind === 'rug_rich') {
      ctx.fillStyle = 'rgba(160,30,30,0.55)';
      ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + pad + 2, py + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
      ctx.fillStyle = gold;
      ctx.fillRect(px + s * 0.42, py + s * 0.42, s * 0.16, s * 0.16);
    } else {
      ctx.fillStyle = th.rug.replace(/0\.\d+/g, '0.4');
      ctx.fillRect(px + pad, py + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + pad + 2, py + pad + 2, s - pad * 2 - 4, s - pad * 2 - 4);
    }
    return;
  }

  // --- chandelier mark ---
  if (kind === 'chandelier') {
    ctx.strokeStyle = gold;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.12);
    ctx.lineTo(px + s * 0.5, py + s * 0.32);
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.28);
    ctx.lineTo(px + s * 0.22, py + s * 0.42);
    ctx.lineTo(px + s * 0.78, py + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff0a0';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.48, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,100,0.35)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.5, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // --- fireplace silhouette ---
  if (kind === 'fireplace') {
    ctx.fillStyle = '#3a3030';
    ctx.fillRect(px + m, py + m * 0.8, s - m * 2, s - m * 1.4);
    ctx.fillStyle = shadeColor(th.wall, 5);
    ctx.fillRect(px + m + 2, py + m * 0.8 + 2, s - m * 2 - 4, s * 0.18);
    ctx.fillStyle = '#1a1010';
    ctx.fillRect(px + m + 4, py + m * 0.8 + s * 0.22, s - m * 2 - 8, s * 0.38);
    // Embers
    ctx.fillStyle = '#e07030';
    ctx.fillRect(px + s * 0.32, py + s * 0.62, s * 0.12, s * 0.08);
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(px + s * 0.48, py + s * 0.60, s * 0.14, s * 0.1);
    ctx.fillStyle = gold;
    ctx.fillRect(px + m, py + m * 0.8, s - m * 2, 2);
    return;
  }

  // --- art frame ---
  if (kind === 'art_frame') {
    ctx.fillStyle = gold;
    ctx.fillRect(px + m * 1.1, py + m * 0.9, s - m * 2.2, s - m * 1.8);
    ctx.fillStyle = floor === 1 ? '#405878' : floor === 2 ? '#785040' : '#587048';
    ctx.fillRect(px + m * 1.1 + 3, py + m * 0.9 + 3, s - m * 2.2 - 6, s - m * 1.8 - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(px + m * 1.1 + 5, py + m * 0.9 + 5, s * 0.2, s * 0.15);
    // Simple motif
    ctx.fillStyle = 'rgba(255,240,200,0.45)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.48, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // --- armor stand ---
  if (kind === 'armor') {
    ctx.fillStyle = '#6a6870';
    // Helmet
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.28, s * 0.14, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(px + s * 0.36, py + s * 0.26, s * 0.28, s * 0.1);
    // Body
    ctx.fillStyle = '#585860';
    ctx.fillRect(px + s * 0.34, py + s * 0.36, s * 0.32, s * 0.32);
    // Arms
    ctx.fillRect(px + s * 0.2, py + s * 0.38, s * 0.14, s * 0.1);
    ctx.fillRect(px + s * 0.66, py + s * 0.38, s * 0.14, s * 0.1);
    // Gold trim
    ctx.fillStyle = gold;
    ctx.fillRect(px + s * 0.46, py + s * 0.4, s * 0.08, s * 0.22);
    // Stand base
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.28, py + s * 0.72, s * 0.44, s * 0.08);
    return;
  }

  // --- banner ---
  if (kind === 'banner') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.46, py + m * 0.5, s * 0.08, s * 0.7);
    ctx.fillStyle = floor === 1 ? '#3a4060' : floor === 2 ? '#8a3020' : '#6a4020';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.28, py + m * 0.6);
    ctx.lineTo(px + s * 0.72, py + m * 0.6);
    ctx.lineTo(px + s * 0.72, py + s * 0.55);
    ctx.lineTo(px + s * 0.5, py + s * 0.68);
    ctx.lineTo(px + s * 0.28, py + s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = gold;
    ctx.fillRect(px + s * 0.28, py + m * 0.6, s * 0.44, 3);
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.38, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // --- deco wooden chest ---
  if (kind === 'chest_deco') {
    ctx.fillStyle = '#6a4828';
    ctx.fillRect(px + m, py + s * 0.38, s - m * 2, s * 0.4);
    ctx.fillStyle = '#8a6438';
    ctx.fillRect(px + m + 2, py + s * 0.3, s - m * 2 - 4, s * 0.16);
    ctx.fillStyle = gold;
    ctx.fillRect(px + m, py + s * 0.44, s - m * 2, 2);
    ctx.fillRect(px + s * 0.45, py + s * 0.48, s * 0.1, s * 0.12);
    return;
  }

  // --- lantern (keep) ---
  if (kind === 'lantern') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.46, py + s * 0.12, s * 0.08, s * 0.18);
    ctx.fillStyle = '#3a3020';
    ctx.fillRect(px + s * 0.32, py + s * 0.28, s * 0.36, s * 0.4);
    ctx.fillStyle = '#f0c860';
    ctx.fillRect(px + s * 0.38, py + s * 0.34, s * 0.24, s * 0.28);
    ctx.fillStyle = 'rgba(255,200,80,0.3)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.48, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gold;
    ctx.fillRect(px + s * 0.32, py + s * 0.28, s * 0.36, 2);
    ctx.fillRect(px + s * 0.32, py + s * 0.66, s * 0.36, 2);
    return;
  }

  // --- Osaka: castle lantern ---
  if (kind === 'castle_lantern') {
    ctx.fillStyle = '#1a1612';
    ctx.fillRect(px + s * 0.3, py + s * 0.22, s * 0.4, s * 0.5);
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(px + s * 0.36, py + s * 0.3, s * 0.28, s * 0.34);
    ctx.fillStyle = gold;
    ctx.fillRect(px + s * 0.28, py + s * 0.18, s * 0.44, 4);
    ctx.fillRect(px + s * 0.28, py + s * 0.7, s * 0.44, 4);
    // Roof tip
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.06);
    ctx.lineTo(px + s * 0.22, py + s * 0.2);
    ctx.lineTo(px + s * 0.78, py + s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,220,100,0.35)';
    ctx.beginPath();
    ctx.arc(px + s * 0.5, py + s * 0.48, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // --- Osaka: gold screen / byobu ---
  if (kind === 'gold_screen' || kind === 'byobu') {
    const panels = kind === 'byobu' ? 3 : 2;
    const padX = m * 0.8;
    const pw = (s - padX * 2) / panels;
    for (let i = 0; i < panels; i++) {
      const sx0 = px + padX + i * pw;
      ctx.fillStyle = i % 2 === 0 ? '#e8d060' : '#d4af37';
      ctx.fillRect(sx0, py + m * 0.7, pw - 1, s - m * 1.5);
      ctx.fillStyle = '#fff0a0';
      ctx.fillRect(sx0 + 2, py + m * 0.7 + 2, pw - 5, 3);
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(sx0, py + m * 0.7, 1, s - m * 1.5);
      // Cloud / wave motif
      ctx.fillStyle = 'rgba(180,40,40,0.35)';
      ctx.beginPath();
      ctx.arc(sx0 + pw * 0.5, py + s * 0.45, pw * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(px + padX, py + m * 0.7, s - padX * 2, 2);
    ctx.fillRect(px + padX, py + s - m * 0.8 - 2, s - padX * 2, 2);
    return;
  }

  // --- Osaka: ornate chest ---
  if (kind === 'ornate_chest') {
    ctx.fillStyle = '#5a3020';
    ctx.fillRect(px + m, py + s * 0.36, s - m * 2, s * 0.42);
    ctx.fillStyle = '#8a4830';
    ctx.fillRect(px + m + 2, py + s * 0.28, s - m * 2 - 4, s * 0.16);
    ctx.fillStyle = gold;
    ctx.fillRect(px + m, py + s * 0.42, s - m * 2, 3);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + m + 3, py + s * 0.5, s - m * 2 - 6, s * 0.22);
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(px + s * 0.44, py + s * 0.55, s * 0.12, s * 0.1);
    return;
  }

  // --- decorative pillar / corner post ---
  if (kind === 'pillar') {
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(px + s * 0.38, py + m * 0.5, s * 0.24, s - m);
    ctx.fillStyle = gold;
    ctx.fillRect(px + s * 0.34, py + m * 0.5, s * 0.32, 4);
    ctx.fillRect(px + s * 0.34, py + s - m * 0.7, s * 0.32, 4);
    ctx.fillStyle = '#fff0a0';
    ctx.fillRect(px + s * 0.44, py + m * 0.5 + 6, s * 0.12, s - m * 1.4);
    return;
  }

  // --- desk (study) ---
  if (kind === 'desk') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + m * 0.8, py + s * 0.42, s - m * 1.6, s * 0.28);
    ctx.fillStyle = woodHi;
    ctx.fillRect(px + m * 0.8 + 2, py + s * 0.34, s - m * 1.6 - 4, s * 0.14);
    ctx.fillStyle = woodDk;
    const dw = Math.max(2, s * 0.06);
    ctx.fillRect(px + m * 0.8 + 2, py + s * 0.7, dw, s * 0.12);
    ctx.fillRect(px + s - m * 0.8 - 2 - dw, py + s * 0.7, dw, s * 0.12);
    // Paper / blotter
    ctx.fillStyle = '#f5f0e0';
    ctx.fillRect(px + s * 0.28, py + s * 0.38, s * 0.36, s * 0.08);
    ctx.fillStyle = '#4060a0';
    ctx.fillRect(px + s * 0.58, py + s * 0.36, s * 0.08, s * 0.04);
    return;
  }

  // --- chair ---
  if (kind === 'chair') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.28, py + s * 0.22, s * 0.44, s * 0.12);
    ctx.fillStyle = wood;
    ctx.fillRect(px + s * 0.26, py + s * 0.42, s * 0.48, s * 0.22);
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.28, py + s * 0.64, s * 0.08, s * 0.14);
    ctx.fillRect(px + s * 0.64, py + s * 0.64, s * 0.08, s * 0.14);
    ctx.fillStyle = th.rug.replace(/0\.\d+/g, '0.45');
    ctx.fillRect(px + s * 0.3, py + s * 0.46, s * 0.4, s * 0.12);
    return;
  }

  // --- TV / console stand (living) ---
  if (kind === 'tv_stand') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + m, py + s * 0.58, s - m * 2, s * 0.22);
    ctx.fillStyle = wood;
    ctx.fillRect(px + m + 2, py + s * 0.6, s - m * 2 - 4, s * 0.1);
    ctx.fillStyle = '#1a1e28';
    ctx.fillRect(px + s * 0.22, py + s * 0.22, s * 0.56, s * 0.34);
    ctx.fillStyle = '#3a6088';
    ctx.fillRect(px + s * 0.26, py + s * 0.26, s * 0.48, s * 0.26);
    ctx.fillStyle = 'rgba(200,230,255,0.25)';
    ctx.fillRect(px + s * 0.3, py + s * 0.28, s * 0.16, s * 0.1);
    return;
  }

  // --- coat rack (entrance) ---
  if (kind === 'coat_rack') {
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.46, py + s * 0.18, s * 0.08, s * 0.58);
    ctx.fillRect(px + s * 0.32, py + s * 0.72, s * 0.36, s * 0.08);
    ctx.strokeStyle = wood;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.28);
    ctx.lineTo(px + s * 0.28, py + s * 0.22);
    ctx.moveTo(px + s * 0.5, py + s * 0.32);
    ctx.lineTo(px + s * 0.72, py + s * 0.24);
    ctx.moveTo(px + s * 0.5, py + s * 0.38);
    ctx.lineTo(px + s * 0.26, py + s * 0.36);
    ctx.stroke();
    // Hanging coat hint
    ctx.fillStyle = floor === 1 ? '#4a6080' : floor === 2 ? '#804040' : '#706040';
    ctx.fillRect(px + s * 0.22, py + s * 0.3, s * 0.14, s * 0.28);
    return;
  }

  // --- attic crate ---
  if (kind === 'crate') {
    ctx.fillStyle = '#8a6a38';
    ctx.fillRect(px + m, py + s * 0.38, s - m * 2, s * 0.42);
    ctx.fillStyle = '#a88848';
    ctx.fillRect(px + m + 2, py + s * 0.4, s - m * 2 - 4, s * 0.12);
    ctx.strokeStyle = '#5a4020';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + m + 1, py + s * 0.38, s - m * 2 - 2, s * 0.42);
    ctx.beginPath();
    ctx.moveTo(px + m + 1, py + s * 0.58);
    ctx.lineTo(px + s - m - 1, py + s * 0.58);
    ctx.stroke();
    return;
  }

  // --- attic trunk ---
  if (kind === 'trunk') {
    ctx.fillStyle = '#5a3820';
    ctx.fillRect(px + m, py + s * 0.42, s - m * 2, s * 0.36);
    ctx.fillStyle = '#7a5030';
    ctx.fillRect(px + m + 2, py + s * 0.32, s - m * 2 - 4, s * 0.16);
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(px + m, py + s * 0.48, s - m * 2, 2);
    ctx.fillRect(px + s * 0.44, py + s * 0.52, s * 0.12, s * 0.1);
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(px + m + 4, py + s * 0.36, s - m * 2 - 8, 2);
    return;
  }

  // --- cottage stove / kitchen ---
  if (kind === 'stove') {
    ctx.fillStyle = '#4a4848';
    ctx.fillRect(px + m, py + s * 0.28, s - m * 2, s * 0.5);
    ctx.fillStyle = '#2a2828';
    ctx.fillRect(px + m + 3, py + s * 0.36, s - m * 2 - 6, s * 0.28);
    ctx.fillStyle = '#e07030';
    ctx.beginPath();
    ctx.arc(px + s * 0.38, py + s * 0.5, s * 0.06, 0, Math.PI * 2);
    ctx.arc(px + s * 0.58, py + s * 0.48, s * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a6868';
    ctx.fillRect(px + s * 0.42, py + s * 0.18, s * 0.16, s * 0.12);
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + m, py + s * 0.74, s - m * 2, s * 0.08);
    return;
  }

  // --- throne (keep / Osaka 3F) ---
  if (kind === 'throne') {
    const isOsaka = skinId === 'osaka';
    const seat = isOsaka ? '#8a2018' : '#5a3038';
    const trim = isOsaka ? '#ffe08a' : gold;
    // Back
    ctx.fillStyle = trim;
    ctx.fillRect(px + s * 0.22, py + s * 0.12, s * 0.56, s * 0.48);
    ctx.fillStyle = seat;
    ctx.fillRect(px + s * 0.26, py + s * 0.16, s * 0.48, s * 0.4);
    // Crest
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.06);
    ctx.lineTo(px + s * 0.28, py + s * 0.18);
    ctx.lineTo(px + s * 0.72, py + s * 0.18);
    ctx.closePath();
    ctx.fill();
    // Seat cushion
    ctx.fillStyle = isOsaka ? '#c04040' : '#704050';
    ctx.fillRect(px + s * 0.24, py + s * 0.52, s * 0.52, s * 0.18);
    // Arms
    ctx.fillStyle = trim;
    ctx.fillRect(px + s * 0.16, py + s * 0.48, s * 0.1, s * 0.26);
    ctx.fillRect(px + s * 0.74, py + s * 0.48, s * 0.1, s * 0.26);
    // Base
    ctx.fillStyle = woodDk;
    ctx.fillRect(px + s * 0.22, py + s * 0.72, s * 0.56, s * 0.1);
    if (isOsaka) {
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(px + s * 0.42, py + s * 0.28, s * 0.16, s * 0.16);
    }
    return;
  }
}


/** Roof caps / corner gold accents for keep & Osaka-castle skins. */
function drawSkinOrnaments(ctx, blueprint, floor, ox, oy, cellSize, skin) {
  if (!skin || skin.ornaments === 'none') return;
  const kind = skin.ornaments;
  const roofDark = kind === 'castle' ? '#1a1612' : kind === 'keep' ? '#2a2620' : '#3a3428';
  const gold = kind === 'castle' ? '#e8c547' : '#d4af37';
  const goldHi = '#fff0a0';

  // Top-edge roof shingles on outer wall row
  if (kind === 'castle' || kind === 'keep' || kind === 'trim') {
    for (let x = 0; x < COLS; x++) {
      if (blueprint[floor][0][x] !== T.WALL) continue;
      const px = ox + x * cellSize;
      const py = oy;
      const rh = Math.max(3, cellSize * (kind === 'trim' ? 0.12 : 0.2));
      ctx.fillStyle = kind === 'trim' ? gold : roofDark;
      ctx.fillRect(px, py, cellSize, rh);
      if (kind !== 'trim') {
        ctx.fillStyle = gold;
        ctx.fillRect(px, py, cellSize, 2);
        // Tile seams
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + cellSize * 0.5, py + 2);
        ctx.lineTo(px + cellSize * 0.5, py + rh);
        ctx.stroke();
      }
      // Decorative roof corners (castle / keep)
      if ((kind === 'castle' || kind === 'keep') && (x === 0 || x === COLS - 1)) {
        const tipY = py - cellSize * (kind === 'castle' ? 0.22 : 0.14);
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.moveTo(px + cellSize * 0.5, tipY);
        ctx.lineTo(px + cellSize * 0.12, py + 2);
        ctx.lineTo(px + cellSize * 0.88, py + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = goldHi;
        ctx.beginPath();
        ctx.moveTo(px + cellSize * 0.5, tipY + 2);
        ctx.lineTo(px + cellSize * 0.35, py);
        ctx.lineTo(px + cellSize * 0.65, py);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Side / bottom gold edge accents for castle skins
  if (kind === 'castle' || kind === 'keep') {
    for (let y = 0; y < ROWS; y++) {
      for (const x of [0, COLS - 1]) {
        if (blueprint[floor][y][x] !== T.WALL) continue;
        const px = ox + x * cellSize;
        const py = oy + y * cellSize;
        ctx.fillStyle = gold;
        if (x === 0) ctx.fillRect(px, py, 2, cellSize);
        else ctx.fillRect(px + cellSize - 2, py, 2, cellSize);
      }
    }
    // Bottom row dark base
    for (let x = 0; x < COLS; x++) {
      if (blueprint[floor][ROWS - 1][x] !== T.WALL) continue;
      const px = ox + x * cellSize;
      const py = oy + (ROWS - 1) * cellSize;
      ctx.fillStyle = roofDark;
      ctx.fillRect(px, py + cellSize - Math.max(3, cellSize * 0.14), cellSize, Math.max(3, cellSize * 0.14));
      ctx.fillStyle = gold;
      ctx.fillRect(px, py + cellSize - 2, cellSize, 2);
    }
  }

  // Inner cross-wall gold studs for mansion/villa trim
  if (kind === 'trim') {
    const studs = [[4, 0], [8, 0], [0, 4], [12, 4], [4, 8], [8, 8]];
    for (const [sx, sy] of studs) {
      if (blueprint[floor][sy][sx] !== T.WALL) continue;
      const px = ox + sx * cellSize + cellSize * 0.35;
      const py = oy + sy * cellSize + cellSize * 0.35;
      ctx.fillStyle = gold;
      ctx.fillRect(px, py, cellSize * 0.3, cellSize * 0.3);
      ctx.fillStyle = goldHi;
      ctx.fillRect(px + 1, py + 1, cellSize * 0.12, cellSize * 0.12);
    }
  }
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
    skinId = 'basic',
  } = opts;

  const mapW = COLS * cellSize;
  const mapH = ROWS * cellSize;
  const skin = getHouseSkin(skinId);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = blueprint[floor][y][x];
      const px = ox + x * cellSize;
      const py = oy + y * cellSize;

      if (t === T.WALL) {
        drawWallTile(ctx, px, py, cellSize, floor, skinId);
      } else if (t === T.DOOR) {
        drawDoorTile(ctx, px, py, cellSize, floor, skinId);
      } else if (t === T.STAIRS_UP) {
        drawStairsTile(ctx, px, py, cellSize, true, floor, skinId);
      } else if (t === T.STAIRS_DOWN) {
        drawStairsTile(ctx, px, py, cellSize, false, floor, skinId);
      } else {
        drawWoodFloor(ctx, px, py, cellSize, x, y, floor, skinId);
      }
    }
  }

  // Soft rugs in room centers (house feel; richer borders at higher skins)
  const th = themeForFloor(floor, skinId);
  const rugCells = [
    [2, 2], [6, 2], [10, 2],
    [2, 6], [6, 6], [10, 6],
  ];
  const rugTier = ({ basic: 0, cottage: 1, mansion: 2, villa: 3, castle_keep: 4, osaka: 5 })[skinId] || 0;
  for (const [rx, ry] of rugCells) {
    if (blueprint[floor][ry][rx] !== T.FLOOR) continue;
    const rpx = ox + rx * cellSize;
    const rpy = oy + ry * cellSize;
    ctx.fillStyle = rugTier >= 5
      ? th.rug.replace(/0\.\d+/g, '0.38')
      : rugTier >= 3
        ? th.rug.replace(/0\.\d+/g, '0.32')
        : th.rug;
    const rr = cellSize * (rugTier >= 4 ? 0.06 : 0.08);
    const inset = rugTier >= 5 ? 0.1 : 0.15;
    const rx0 = rpx + cellSize * inset;
    const ry0 = rpy + cellSize * inset;
    const rw = cellSize * (1 - inset * 2);
    const rh = cellSize * (1 - inset * 2);
    ctx.beginPath();
    ctx.moveTo(rx0 + rr, ry0);
    ctx.arcTo(rx0 + rw, ry0, rx0 + rw, ry0 + rh, rr);
    ctx.arcTo(rx0 + rw, ry0 + rh, rx0, ry0 + rh, rr);
    ctx.arcTo(rx0, ry0 + rh, rx0, ry0, rr);
    ctx.arcTo(rx0, ry0, rx0 + rw, ry0, rr);
    ctx.closePath();
    ctx.fill();
    if (rugTier >= 2) {
      ctx.strokeStyle = rugTier >= 5 ? (th.badge || '#d4af37') : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = rugTier >= 5 ? 1.5 : 1;
      ctx.strokeRect(rx0 + 2, ry0 + 2, rw - 4, rh - 4);
    }
  }

  // Decorative furniture (visual only — walk/place unchanged)
  drawRoomFurniture(ctx, blueprint, floor, ox, oy, cellSize, skinId);

  // Cosmetic skin ornaments (visual only)
  drawSkinOrnaments(ctx, blueprint, floor, ox, oy, cellSize, skin);

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
 * Optional memoryBias.pathHeat / level bias traps toward player habits.
 * @param {object} blueprint
 * @param {{ pathHeat?: Record<string,number>, level?: number }|null} [memoryBias]
 */
export function generateComHouse(blueprint, memoryBias = null) {
  const cells = listPlaceable(blueprint);
  const spawn = getSpawn();
  const memLevel = Math.max(1, Math.min(11, Math.floor(Number(memoryBias && memoryBias.level) || 1)));
  const lvT = Math.min(1, (memLevel - 1) / 10);
  const pathHeatMap = (memoryBias && memoryBias.pathHeat && typeof memoryBias.pathHeat === 'object')
    ? memoryBias.pathHeat
    : {};
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

  function pathHabit(c) {
    const k = keyOf(c.floor, c.x, c.y);
    return Number(pathHeatMap[k]) || 0;
  }

  function trapScore(c) {
    let s = 0;
    const doorAdj = isAdjTo(c, T.DOOR);
    const stairsAdj = nearStairs(c);
    // Player traffic heat (primary catch signal)
    s += heatOf(c) * 10;
    // Cross-session path habits: bias traps toward cells the player walks often
    const ph = pathHabit(c);
    if (ph > 0) s += Math.min(9, ph * (0.55 + lvT * 0.55));
    if (doorAdj) s += 7 + lvT * 1.5;
    if (stairsAdj && c.floor <= chest.floor) s += 6 + lvT * 1.2;
    if (nearSpawnExit(c)) s += 6 + lvT * 1.5;
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
    s += Math.random() * (1.2 - lvT * 0.4); // slightly less random at high Lv
    return s;
  }

  function pickKind(c) {
    const doorAdj = isAdjTo(c, T.DOOR);
    const spawnExit = nearSpawnExit(c);
    // 1F pits only deal damage (no drop) — almost always use bombs on floor 0
    if (c.floor === 0) return TRAP_BOMB;
    // Door / spawn-exit on upper floors: still prefer bomb
    if (doorAdj || spawnExit) {
      if (Math.random() < 0.85) return TRAP_BOMB;
      return TRAP_PIT;
    }
    // Pits shine on 2F/3F (drop + damage)
    if (c.floor >= 2 && Math.random() < 0.62) return TRAP_PIT;
    if (c.floor === 1 && Math.random() < 0.48) return TRAP_PIT;
    if (Math.random() < 0.22) return TRAP_PIT;
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
  // 1) bombs on spawn-exit / first-room-exit (more at higher Lv / pathHeat)
  {
    const spawnQuota = 3 + (lvT >= 0.4 ? 1 : 0) + (lvT >= 0.8 ? 1 : 0); // 3..5
    const pool = ranked(nearSpawnExit, (c) => heatOf(c) * 8 + pathHabit(c) * (2 + lvT * 3) + trapScore(c));
    let n = 0;
    for (const { c } of pool) {
      if (traps.length >= want || n >= spawnQuota) break;
      if (!canPlace(c)) continue;
      placeTrap(c, TRAP_BOMB);
      n += 1;
    }
  }

  // 2) ~2–3 bombs on door-adjacent (any floor, prefer path to chest; spread floors)
  {
    const doorQuota = 2 + (lvT >= 0.3 ? 1 : 0) + ((Math.random() < 0.45 + lvT * 0.2) ? 1 : 0); // 2..4
    const usedDoorFloors = new Set();
    const pool = ranked(
      (c) => isAdjTo(c, T.DOOR) && !nearSpawnExit(c) && c.floor <= chest.floor,
      (c) =>
        (onPathToChest(c) ? 5 : 0) +
        heatOf(c) * 5 +
        pathHabit(c) * (2 + lvT * 3) +
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
      // Higher Lv: pile remaining bombs on habitual high-traffic cells
      if (lvT > 0) s += pathHabit(c) * lvT * 2.5;
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

  // Convert any leftover 1F pits → bombs (1F pit has little value)
  for (const tr of traps) {
    if (tr.floor === 0 && tr.kind === TRAP_PIT) tr.kind = TRAP_BOMB;
  }

  // Guarantee mix of bomb + pit (pit only on 2F/3F when possible)
  if (traps.length >= 2) {
    const hasPit = traps.some((t) => t.kind === TRAP_PIT);
    const hasBomb = traps.some((t) => t.kind === TRAP_BOMB);
    if (!hasPit) {
      const idx = traps.findIndex((t) => {
        const c = { floor: t.floor, x: t.x, y: t.y };
        return t.floor > 0 && !isAdjTo(c, T.DOOR) && !nearSpawnExit(c);
      });
      const idx2 = traps.findIndex((t) => t.floor > 0);
      traps[(idx >= 0 ? idx : idx2 >= 0 ? idx2 : 0)].kind = TRAP_PIT;
    }
    if (!hasBomb) traps[traps.length - 1].kind = TRAP_BOMB;
  }

  return { chest: { floor: chest.floor, x: chest.x, y: chest.y }, traps };
}

