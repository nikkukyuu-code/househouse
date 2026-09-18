/**
 * ハウスハウス — House layout, placement, and rendering helpers
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

export const MAX_TRAPS = 5;
export const MAX_HP = 3;

/** Fixed 3-floor house blueprint (same for both players; only chest/traps differ) */
export function createBlueprint() {
  // Each floor: ROWS x COLS of tile kinds
  const floors = [];
  for (let f = 0; f < FLOORS; f++) {
    const grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        // Outer wall
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

  // Interior walls forming rooms — same pattern each floor with slight variation
  for (let f = 0; f < FLOORS; f++) {
    const g = floors[f];
    // Vertical dividers
    for (let y = 1; y < ROWS - 1; y++) {
      g[y][4] = T.WALL;
      g[y][8] = T.WALL;
    }
    // Horizontal divider
    for (let x = 1; x < COLS - 1; x++) {
      g[4][x] = T.WALL;
    }
    // Doors in walls
    g[2][4] = T.DOOR; // left-mid vertical
    g[6][4] = T.DOOR;
    g[2][8] = T.DOOR;
    g[6][8] = T.DOOR;
    g[4][2] = T.DOOR; // horizontal
    g[4][6] = T.DOOR;
    g[4][10] = T.DOOR;

    // Stairs: up near top-right room, down near bottom-left (except extremes)
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
  // Only plain floor (not stairs/doors) for chest/traps
  return t === T.FLOOR;
}

/** Empty house data for placement */
export function createEmptyHouseData() {
  return {
    chest: null, // { floor, x, y }
    traps: [], // [{ floor, x, y }]
  };
}

export function serializeHouse(data) {
  return JSON.stringify(data);
}

export function parseHouse(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  if (!d || typeof d !== 'object') throw new Error('invalid house');
  return {
    chest: d.chest || null,
    traps: Array.isArray(d.traps) ? d.traps : [],
  };
}

export function validateHouse(data, blueprint) {
  if (!data.chest) return { ok: false, msg: '宝箱を1つ配置してください' };
  const { floor, x, y } = data.chest;
  if (!isPlaceable(blueprint, floor, x, y)) return { ok: false, msg: '宝箱の位置が不正です' };
  if (data.traps.length > MAX_TRAPS) return { ok: false, msg: `罠は最大${MAX_TRAPS}個です` };
  const seen = new Set();
  seen.add(`${floor},${x},${y}`);
  for (const t of data.traps) {
    if (!isPlaceable(blueprint, t.floor, t.x, t.y)) return { ok: false, msg: '罠の位置が不正です' };
    const key = `${t.floor},${t.x},${t.y}`;
    if (seen.has(key)) return { ok: false, msg: '同じマスに複数置けません' };
    seen.add(key);
  }
  return { ok: true };
}

/** Spawn point: near bottom-center of 1F */
export function getSpawn() {
  return { floor: 0, x: 6, y: 7 };
}

export function tileAt(blueprint, floor, x, y) {
  if (floor < 0 || floor >= FLOORS || x < 0 || y < 0 || x >= COLS || y >= ROWS) return T.WALL;
  return blueprint[floor][y][x];
}

/** Colors for rendering */
export const COLORS = {
  wall: '#3d2b1f',
  wallEdge: '#2a1c14',
  floor: '#e8d5b7',
  floorAlt: '#dcc9a8',
  door: '#8b6914',
  stairsUp: '#5b8c5a',
  stairsDown: '#4a7c9b',
  chest: '#c9a227',
  chestLid: '#e8c547',
  trap: '#8b0000',
  trapArmed: '#cc2222',
  player1: '#3b82f6',
  player2: '#ef4444',
  ghost: 'rgba(100,100,100,0.35)',
  bg: '#1a1520',
  roomLabel: 'rgba(0,0,0,0.15)',
};

export function drawHouse(ctx, blueprint, houseData, floor, opts = {}) {
  const {
    showChest = false,
    showTraps = false,
    triggeredTraps = new Set(),
    ox = 0,
    oy = 0,
    cellSize = TILE,
  } = opts;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = blueprint[floor][y][x];
      const px = ox + x * cellSize;
      const py = oy + y * cellSize;

      if (t === T.WALL) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.fillStyle = COLORS.wallEdge;
        ctx.fillRect(px, py, cellSize, 3);
      } else if (t === T.DOOR) {
        ctx.fillStyle = COLORS.floor;
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.fillStyle = COLORS.door;
        ctx.fillRect(px + 4, py + 4, cellSize - 8, cellSize - 8);
      } else if (t === T.STAIRS_UP) {
        ctx.fillStyle = COLORS.stairsUp;
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.floor(cellSize * 0.35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('▲', px + cellSize / 2, py + cellSize / 2);
      } else if (t === T.STAIRS_DOWN) {
        ctx.fillStyle = COLORS.stairsDown;
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.floor(cellSize * 0.35)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('▼', px + cellSize / 2, py + cellSize / 2);
      } else {
        const alt = (x + y) % 2 === 0;
        ctx.fillStyle = alt ? COLORS.floor : COLORS.floorAlt;
        ctx.fillRect(px, py, cellSize, cellSize);
      }
    }
  }

  // Traps
  if (showTraps && houseData) {
    for (const tr of houseData.traps) {
      if (tr.floor !== floor) continue;
      const key = `${tr.floor},${tr.x},${tr.y}`;
      const px = ox + tr.x * cellSize;
      const py = oy + tr.y * cellSize;
      const triggered = triggeredTraps.has(key);
      ctx.fillStyle = triggered ? '#444' : COLORS.trapArmed;
      ctx.beginPath();
      ctx.arc(px + cellSize / 2, py + cellSize / 2, cellSize * 0.28, 0, Math.PI * 2);
      ctx.fill();
      if (!triggered) {
        ctx.strokeStyle = '#ff6666';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.floor(cellSize * 0.4)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', px + cellSize / 2, py + cellSize / 2 + 1);
      }
    }
  }

  // Chest
  if (showChest && houseData && houseData.chest && houseData.chest.floor === floor) {
    const c = houseData.chest;
    const px = ox + c.x * cellSize;
    const py = oy + c.y * cellSize;
    ctx.fillStyle = COLORS.chest;
    ctx.fillRect(px + 6, py + 10, cellSize - 12, cellSize - 14);
    ctx.fillStyle = COLORS.chestLid;
    ctx.fillRect(px + 4, py + 6, cellSize - 8, 8);
    ctx.fillStyle = '#5c4010';
    ctx.fillRect(px + cellSize / 2 - 3, py + 14, 6, 6);
  }
}

export function drawPlayer(ctx, x, y, color, ox, oy, cellSize = TILE, pulse = 0) {
  const px = ox + x * cellSize + cellSize / 2;
  const py = oy + y * cellSize + cellSize / 2;
  const r = cellSize * 0.32 + Math.sin(pulse) * 1.5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(px - r * 0.3, py - r * 0.2, r * 0.22, 0, Math.PI * 2);
  ctx.arc(px + r * 0.3, py - r * 0.2, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(px - r * 0.3, py - r * 0.2, r * 0.1, 0, Math.PI * 2);
  ctx.arc(px + r * 0.3, py - r * 0.2, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

export function floorLabel(f) {
  return `${f + 1}F`;
}

/** Collect all placeable floor cells */
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
 * COM house generation: prefer upper floors / corner rooms for chest,
 * traps near doors, stairs approaches, and mid-room choke points.
 * Imperfect — not every good spot is used.
 */
export function generateComHouse(blueprint) {
  const cells = listPlaceable(blueprint);
  const spawn = getSpawn();
  const dist = (c) => Math.abs(c.x - spawn.x) + Math.abs(c.y - spawn.y) + c.floor * 4;

  // Prefer chest far from spawn, often 2F/3F
  const chestCandidates = shuffle(cells)
    .filter((c) => !(c.floor === spawn.floor && c.x === spawn.x && c.y === spawn.y))
    .sort((a, b) => dist(b) - dist(a));
  // Pick from top 40% with some randomness
  const topN = Math.max(5, (chestCandidates.length * 0.4) | 0);
  const chest = chestCandidates[(Math.random() * topN) | 0];

  const used = new Set([`${chest.floor},${chest.x},${chest.y}`]);

  // Trap heuristic scores
  function trapScore(c) {
    let s = 0;
    // Near doors / stairs
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const t = tileAt(blueprint, c.floor, c.x + dx, c.y + dy);
      if (t === T.DOOR) s += 4;
      if (t === T.STAIRS_UP || t === T.STAIRS_DOWN) s += 5;
    }
    // Prefer same floor as chest sometimes (guard)
    if (c.floor === chest.floor) s += 2;
    // Near chest but not on it
    const cd = Math.abs(c.x - chest.x) + Math.abs(c.y - chest.y);
    if (c.floor === chest.floor && cd >= 1 && cd <= 3) s += 3;
    // Spawn area lightly
    if (c.floor === 0 && dist(c) <= 4) s += 1;
    s += Math.random() * 2; // noise
    return s;
  }

  const trapPool = cells
    .filter((c) => !used.has(`${c.floor},${c.x},${c.y}`))
    .map((c) => ({ c, s: trapScore(c) }))
    .sort((a, b) => b.s - a.s);

  const traps = [];
  const want = MAX_TRAPS;
  // Take good spots but skip some (imperfect) — every other or random reject
  for (let i = 0; i < trapPool.length && traps.length < want; i++) {
    if (Math.random() < 0.22 && traps.length > 1) continue; // skip some good ones
    const { c } = trapPool[i];
    const key = `${c.floor},${c.x},${c.y}`;
    if (used.has(key)) continue;
    used.add(key);
    traps.push({ floor: c.floor, x: c.x, y: c.y });
  }

  return { chest: { floor: chest.floor, x: chest.x, y: chest.y }, traps };
}
