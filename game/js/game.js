/**
 * ハウスと罠 — Core game loop (mobile-first)
 */

import {
  TILE, FLOORS, COLS, ROWS, T, MAX_TRAPS, MAX_HP, BOMB_DAMAGE, PIT_DAMAGE,
  TRAP_BOMB, TRAP_PIT, normalizeTrap,
  createBlueprint, createEmptyHouseData, isWalkable, isPlaceable,
  validateHouse, getSpawn, tileAt, drawHouse, drawPlayer, drawTrapSprite, drawChestSprite,
  floorLabel, COLORS, generateComHouse, parseHouse,
} from './house.js?v=20260920g';
import { NetSession, loadPeerJS, isPeerAvailable, isValidRoomCode, normalizeRoomCode } from './net.js?v=20260920g';
import { $, showScreen, setStatus, heartsHtml, bindHold, bindTap, lockTouch, flashOverlay } from './ui.js?v=20260920g';
import { unlockAudio, loadMutePref, setMuted, isMuted, play as sfx } from './sound.js?v=20260920g';

const blueprint = createBlueprint();

/** App state */
const S = {
  mode: null, // 'online-host' | 'online-guest' | 'local' | 'com'
  net: null,
  phase: 'title',
  myHouse: createEmptyHouseData(),
  theirHouse: createEmptyHouseData(),
  setupTool: 'chest', // 'chest' | 'trap-bomb' | 'trap-pit' | 'erase'
  setupFloor: 0,
  setupWhich: 'mine',
  localStep: 0,
  me: null,
  foe: null,
  myHp: MAX_HP,
  foeHp: MAX_HP,
  myTriggered: new Set(),
  foeTriggered: new Set(),
  ended: false,
  winner: null,
  holdDir: null,
  moveCooldown: 0,
  fx: [],
  time: 0,
  readyMine: false,
  readyTheirs: false,
  peerReady: false,
  iAmReady: false,
  /** After win/lose, reveal opponent chest on bottom view */
  revealSecrets: false,
  /** Spotlight enlarge: char + chest/trap at hit moment */
  heroFocus: null,
};

let canvTop, canvBot, ctxTop, ctxBot;
let animId = 0;
let lastTs = 0;

/** Always use CSS pixel size from layout — never canvas.width (DPR backing store). */
function cssSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.clientWidth || 1;
  const h = rect.height || canvas.clientHeight || 1;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function cellSizeFor(canvas) {
  const { w, h } = cssSize(canvas);
  return Math.max(1, Math.floor(Math.min(w / COLS, h / ROWS)));
}

function isTrapTool(tool) {
  return tool === 'trap' || tool === 'trap-bomb' || tool === 'trap-normal' || tool === 'trap-pit';
}

function layoutCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = c.getBoundingClientRect();
  const cssW = Math.max(1, rect.width);
  const cssH = Math.max(1, rect.height);
  c.width = Math.floor(cssW * dpr);
  c.height = Math.floor(cssH * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function resizeCanvases() {
  if (canvTop) ctxTop = layoutCanvas(canvTop);
  if (canvBot) ctxBot = layoutCanvas(canvBot);
  const setup = $('setup-canvas');
  if (setup && setup.classList.contains('active-canvas')) {
    layoutCanvas(setup);
  }
}

function makeExplorer(houseData, label) {
  const sp = getSpawn();
  return {
    label,
    floor: sp.floor,
    x: sp.x,
    y: sp.y,
    house: houseData,
    hp: MAX_HP,
    triggered: new Set(),
    foundChest: false,
    dead: false,
  };
}

function tryMove(ex, dx, dy) {
  const nx = ex.x + dx;
  const ny = ex.y + dy;
  const t = tileAt(blueprint, ex.floor, nx, ny);
  if (!isWalkable(t)) return false;
  ex.x = nx;
  ex.y = ny;
  if (t === T.STAIRS_UP && ex.floor < FLOORS - 1) {
    if (ex === S.me) sfx('stairs');
    ex.floor += 1;
    const down = findStairs(ex.floor, T.STAIRS_DOWN);
    if (down) { ex.x = down.x; ex.y = down.y; }
  } else if (t === T.STAIRS_DOWN && ex.floor > 0) {
    if (ex === S.me) sfx('stairs');
    ex.floor -= 1;
    const up = findStairs(ex.floor, T.STAIRS_UP);
    if (up) { ex.x = up.x; ex.y = up.y; }
  }
  return true;
}

function findStairs(floor, kind) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (blueprint[floor][y][x] === kind) return { x, y };
    }
  }
  return null;
}

/**
 * Pitfall drop: if not on 1F, go to floor below.
 * Prefer same x,y if walkable; else near stairs-down of the floor fallen from
 * (arrive at stairs-up on the lower floor); else any walkable.
 */
function applyPitfallDrop(ex) {
  if (ex.floor <= 0) return false;
  const fromFloor = ex.floor;
  const sx = ex.x;
  const sy = ex.y;
  ex.floor -= 1;

  if (isWalkable(tileAt(blueprint, ex.floor, sx, sy))) {
    ex.x = sx;
    ex.y = sy;
    return true;
  }

  // Stairs-down on the floor we fell from → land at stairs-up on new floor
  const downOnFrom = findStairs(fromFloor, T.STAIRS_DOWN);
  if (downOnFrom) {
    const neighbors = [
      { x: downOnFrom.x, y: downOnFrom.y },
      { x: downOnFrom.x + 1, y: downOnFrom.y },
      { x: downOnFrom.x - 1, y: downOnFrom.y },
      { x: downOnFrom.x, y: downOnFrom.y + 1 },
      { x: downOnFrom.x, y: downOnFrom.y - 1 },
    ];
    for (const n of neighbors) {
      if (isWalkable(tileAt(blueprint, ex.floor, n.x, n.y))) {
        ex.x = n.x;
        ex.y = n.y;
        return true;
      }
    }
  }

  const up = findStairs(ex.floor, T.STAIRS_UP);
  if (up && isWalkable(tileAt(blueprint, ex.floor, up.x, up.y))) {
    ex.x = up.x;
    ex.y = up.y;
    return true;
  }

  // Any walkable cell
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (isWalkable(tileAt(blueprint, ex.floor, x, y))) {
        ex.x = x;
        ex.y = y;
        return true;
      }
    }
  }
  return true;
}

function checkHazards(ex, triggeredSet, onTrap, onChest) {
  const h = ex.house;
  if (!h) return;
  for (const raw of h.traps) {
    const tr = normalizeTrap(raw);
    if (!tr) continue;
    if (tr.floor === ex.floor && tr.x === ex.x && tr.y === ex.y) {
      const key = `${tr.floor},${tr.x},${tr.y}`;
      if (!triggeredSet.has(key)) {
        triggeredSet.add(key);
        ex.triggered.add(key);
        onTrap(tr, key);
      }
    }
  }
  if (h.chest && h.chest.floor === ex.floor && h.chest.x === ex.x && h.chest.y === ex.y) {
    if (!ex.foundChest) {
      ex.foundChest = true;
      onChest();
    }
  }
}

/* ---------- COM / AI explorer (BFS floor-clearing) ---------- */
const AI_DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function aiNeighbors(floor, x, y) {
  const out = [];
  for (const [dx, dy] of AI_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (isWalkable(tileAt(blueprint, floor, nx, ny))) out.push({ x: nx, y: ny, dx, dy });
  }
  return out;
}

/** Walkable cells on a floor that are not yet in visited. */
function aiFloorUnvisited(floor, visited) {
  const cells = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!isWalkable(tileAt(blueprint, floor, x, y))) continue;
      if (!visited.has(`${floor},${x},${y}`)) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * BFS on one floor from (sx,sy) to nearest goal matching predicate.
 * Returns first step {dx,dy} or null. Optionally avoid reversing last move.
 */
function aiBfsNextStep(floor, sx, sy, isGoal, preferNotDx, preferNotDy) {
  const startKey = `${sx},${sy}`;
  if (isGoal(sx, sy)) return null;
  const q = [{ x: sx, y: sy }];
  const prev = new Map();
  prev.set(startKey, null);
  let found = null;
  while (q.length) {
    const cur = q.shift();
    for (const n of aiNeighbors(floor, cur.x, cur.y)) {
      const k = `${n.x},${n.y}`;
      if (prev.has(k)) continue;
      prev.set(k, { x: cur.x, y: cur.y, stepDx: n.dx, stepDy: n.dy });
      if (isGoal(n.x, n.y)) {
        found = { x: n.x, y: n.y };
        q.length = 0;
        break;
      }
      q.push({ x: n.x, y: n.y });
    }
  }
  if (!found) return null;
  // Walk back to reconstruct first step from start
  let cx = found.x;
  let cy = found.y;
  let first = null;
  while (true) {
    const p = prev.get(`${cx},${cy}`);
    if (!p) break;
    first = { dx: p.stepDx, dy: p.stepDy };
    if (p.x === sx && p.y === sy) break;
    cx = p.x;
    cy = p.y;
  }
  if (!first) return null;
  // Prefer not reversing: if first step is reverse and another equally-short path exists, try alt
  if (
    preferNotDx != null && preferNotDy != null
    && first.dx === -preferNotDx && first.dy === -preferNotDy
  ) {
    const alt = aiBfsNextStepAvoidReverse(floor, sx, sy, isGoal, preferNotDx, preferNotDy);
    if (alt) return alt;
  }
  return first;
}

/** Second BFS that forbids the immediate reverse as the first edge from start. */
function aiBfsNextStepAvoidReverse(floor, sx, sy, isGoal, lastDx, lastDy) {
  const startKey = `${sx},${sy}`;
  const q = [{ x: sx, y: sy }];
  const prev = new Map();
  prev.set(startKey, null);
  let found = null;
  while (q.length) {
    const cur = q.shift();
    for (const n of aiNeighbors(floor, cur.x, cur.y)) {
      if (cur.x === sx && cur.y === sy && n.dx === -lastDx && n.dy === -lastDy) continue;
      const k = `${n.x},${n.y}`;
      if (prev.has(k)) continue;
      prev.set(k, { x: cur.x, y: cur.y, stepDx: n.dx, stepDy: n.dy });
      if (isGoal(n.x, n.y)) {
        found = { x: n.x, y: n.y };
        q.length = 0;
        break;
      }
      q.push({ x: n.x, y: n.y });
    }
  }
  if (!found) return null;
  let cx = found.x;
  let cy = found.y;
  let first = null;
  while (true) {
    const p = prev.get(`${cx},${cy}`);
    if (!p) break;
    first = { dx: p.stepDx, dy: p.stepDy };
    if (p.x === sx && p.y === sy) break;
    cx = p.x;
    cy = p.y;
  }
  return first;
}

function aiFindTile(floor, kind) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (blueprint[floor][y][x] === kind) return { x, y };
    }
  }
  return null;
}

function aiApplyStep(ex, step) {
  if (!step) return false;
  if (tryMove(ex, step.dx, step.dy)) {
    ex.memory.lastDx = step.dx;
    ex.memory.lastDy = step.dy;
    ex.memory.stuck = 0;
    if (!ex.memory.recent) ex.memory.recent = [];
    ex.memory.recent.push(`${ex.floor},${ex.x},${ex.y}`);
    if (ex.memory.recent.length > 8) ex.memory.recent.shift();
    return true;
  }
  return false;
}

function aiIsStuck(ex) {
  const r = ex.memory.recent || [];
  if (r.length < 8) return (ex.memory.stuck || 0) >= 6;
  const uniq = new Set(r);
  return uniq.size <= 2 || (ex.memory.stuck || 0) >= 5;
}


/** If already standing on the right stairs for targetFloor, transition now. */

function aiTriggeredSet(ex) {
  const set = new Set();
  if (ex && ex.triggered) {
    for (const k of ex.triggered) set.add(k);
  }
  // COM explores player's house → foeTriggered
  if (ex === S.foe && S.foeTriggered) {
    for (const k of S.foeTriggered) set.add(k);
  }
  if (ex === S.me && S.myTriggered) {
    for (const k of S.myTriggered) set.add(k);
  }
  return set;
}

function aiIsCellTriggered(ex, floor, x, y) {
  const k = `${floor},${x},${y}`;
  if (ex && ex.triggered && ex.triggered.has(k)) return true;
  if (ex === S.foe && S.foeTriggered && S.foeTriggered.has(k)) return true;
  if (ex === S.me && S.myTriggered && S.myTriggered.has(k)) return true;
  return false;
}

function aiIsDoorAdjacent(floor, x, y) {
  for (const [dx, dy] of AI_DIRS) {
    if (tileAt(blueprint, floor, x + dx, y + dy) === T.DOOR) return true;
  }
  return false;
}

function aiInSpawnRoom(floor, x, y) {
  if (floor !== 0) return false;
  return x > 4 && x < 8 && y > 4 && y < ROWS - 1;
}

function aiNearSpawnExit(floor, x, y) {
  if (floor !== 0) return false;
  const sp = getSpawn();
  const man = Math.abs(x - sp.x) + Math.abs(y - sp.y);
  if (aiInSpawnRoom(floor, x, y) && aiIsDoorAdjacent(floor, x, y)) return true;
  if (man >= 1 && man <= 3) return true;
  if (aiIsDoorAdjacent(floor, x, y) && man <= 6) return true;
  return false;
}

/**
 * Soft danger cost for an unexplored cell. Triggered = 0 (safe).
 * Unknown door-adj / early spawn-exit: slight penalty (still walkable).
 */
function aiCautionCost(ex, floor, x, y) {
  if (aiIsCellTriggered(ex, floor, x, y)) return 0; // spent trap — safe / prefer ok
  const visited = ex.visited;
  const key = `${floor},${x},${y}`;
  // Already visited without dying there → treat as known-safe enough
  if (visited && visited.has(key)) return 0;
  let cost = 0;
  if (aiIsDoorAdjacent(floor, x, y)) cost += 3;
  // Early match: cautious leaving spawn room
  const phase = (ex.memory && ex.memory.phase) || 0;
  if (phase < 40 && aiNearSpawnExit(floor, x, y)) cost += 3;
  return cost;
}

/**
 * Among equal-ish BFS options, prefer stepping onto lower-caution cells.
 * If the only way is a "dangerous" cell, still take it (dead-end / only path).
 */
function aiPickStepWithCaution(ex, candidates) {
  // candidates: [{dx,dy, cost?}]
  if (!candidates || !candidates.length) return null;
  let best = null;
  let bestS = -1e9;
  for (const step of candidates) {
    const nx = ex.x + step.dx;
    const ny = ex.y + step.dy;
    if (!isWalkable(tileAt(blueprint, ex.floor, nx, ny))) continue;
    let s = 10 - aiCautionCost(ex, ex.floor, nx, ny);
    if (aiIsCellTriggered(ex, ex.floor, nx, ny)) s += 2; // known safe path fine
    if (ex.memory && ex.memory.lastDx === -step.dx && ex.memory.lastDy === -step.dy) s -= 2;
    s += Math.random() * 0.5;
    if (s > bestS) { bestS = s; best = step; }
  }
  return best;
}

function aiTakeStairsIfNeeded(ex, targetFloor) {
  if (targetFloor == null || targetFloor === ex.floor) return false;
  const here = tileAt(blueprint, ex.floor, ex.x, ex.y);
  if (targetFloor > ex.floor && here === T.STAIRS_UP && ex.floor < FLOORS - 1) {
    ex.floor += 1;
    const down = findStairs(ex.floor, T.STAIRS_DOWN);
    if (down) { ex.x = down.x; ex.y = down.y; }
    ex.memory.stuck = 0;
    ex.visited.add(`${ex.floor},${ex.x},${ex.y}`);
    if (!ex.memory.recent) ex.memory.recent = [];
    ex.memory.recent.push(`${ex.floor},${ex.x},${ex.y}`);
    if (ex.memory.recent.length > 8) ex.memory.recent.shift();
    return true;
  }
  if (targetFloor < ex.floor && here === T.STAIRS_DOWN && ex.floor > 0) {
    ex.floor -= 1;
    const up = findStairs(ex.floor, T.STAIRS_UP);
    if (up) { ex.x = up.x; ex.y = up.y; }
    ex.memory.stuck = 0;
    ex.visited.add(`${ex.floor},${ex.x},${ex.y}`);
    if (!ex.memory.recent) ex.memory.recent = [];
    ex.memory.recent.push(`${ex.floor},${ex.x},${ex.y}`);
    if (ex.memory.recent.length > 8) ex.memory.recent.shift();
    return true;
  }
  return false;
}

function aiStep(ex) {
  if (!ex.visited) ex.visited = new Set();
  if (!ex.memory) {
    ex.memory = { stuck: 0, phase: 0, lastDx: 0, lastDy: 0, recent: [], escapeGoal: null };
  }
  ex.memory.phase = (ex.memory.phase || 0) + 1;
  const key = `${ex.floor},${ex.x},${ex.y}`;
  ex.visited.add(key);

  const lastDx = ex.memory.lastDx;
  const lastDy = ex.memory.lastDy;

  // Small randomness so play isn't perfectly deterministic
  if (Math.random() < 0.06) {
    const shuffled = AI_DIRS.slice().sort(() => Math.random() - 0.5);
    for (const [dx, dy] of shuffled) {
      if (lastDx === -dx && lastDy === -dy && Math.random() < 0.7) continue;
      const nx = ex.x + dx, ny = ex.y + dy;
      // Soft skip unknown door/spawn danger unless it's the only option later
      if (aiCautionCost(ex, ex.floor, nx, ny) >= 3 && Math.random() < 0.75) continue;
      if (aiApplyStep(ex, { dx, dy })) return true;
    }
  }

  // Anti-stuck: force path toward a random unvisited cell (any floor) via stairs
  if (aiIsStuck(ex)) {
    ex.memory.stuck = (ex.memory.stuck || 0) + 1;
    const allUnvis = [];
    for (let f = 0; f < FLOORS; f++) {
      for (const c of aiFloorUnvisited(f, ex.visited)) {
        allUnvis.push({ floor: f, x: c.x, y: c.y });
      }
    }
    if (allUnvis.length) {
      const goal = allUnvis[(Math.random() * allUnvis.length) | 0];
      ex.memory.escapeGoal = goal;
      if (aiTakeStairsIfNeeded(ex, goal.floor)) return true;
      const step = aiPlanToward(ex, goal, lastDx, lastDy);
      if (aiApplyStep(ex, step)) return true;
    }
  }

  // 1) Clear current floor: BFS to nearest unvisited (caution: soft-avoid unknown door/spawn)
  const unvisHere = aiFloorUnvisited(ex.floor, ex.visited);
  if (unvisHere.length) {
    // Prefer safer unvisited goals first; fall back to any if needed
    const sortedGoals = unvisHere.slice().sort((a, b) => {
      return aiCautionCost(ex, ex.floor, a.x, a.y) - aiCautionCost(ex, ex.floor, b.x, b.y)
        || (Math.random() - 0.5);
    });
    let step = null;
    // Try low-caution goals, then any
    for (const preferSafe of [true, false]) {
      const goals = preferSafe
        ? sortedGoals.filter((c) => aiCautionCost(ex, ex.floor, c.x, c.y) <= 2)
        : sortedGoals;
      if (!goals.length) continue;
      const goalSet = new Set(goals.map((c) => `${c.x},${c.y}`));
      step = aiBfsNextStep(
        ex.floor, ex.x, ex.y,
        (x, y) => goalSet.has(`${x},${y}`),
        lastDx, lastDy
      );
      if (step) {
        // If first step is high-caution but an alternate neighbor leads to a safe goal path, prefer it
        const opts = [];
        for (const [dx, dy] of AI_DIRS) {
          const nx = ex.x + dx, ny = ex.y + dy;
          if (!isWalkable(tileAt(blueprint, ex.floor, nx, ny))) continue;
          // Accept this first step if BFS from neighbor still reaches a goal quickly
          opts.push({ dx, dy });
        }
        // Keep BFS step but if it's very cautious and we have other walkable opts with lower cost that aren't reverse-only dead ends:
        const stepCost = aiCautionCost(ex, ex.floor, ex.x + step.dx, ex.y + step.dy);
        if (stepCost >= 3) {
          const safer = aiPickStepWithCaution(ex, opts.filter((o) => {
            // only consider if that neighbor is closer-ish to some goal via another BFS
            const sub = aiBfsNextStep(ex.floor, ex.x + o.dx, ex.y + o.dy, (x, y) => goalSet.has(`${x},${y}`), null, null);
            // standing on goal after one step counts
            if (goalSet.has(`${ex.x + o.dx},${ex.y + o.dy}`)) return true;
            return !!sub || goalSet.has(`${ex.x + o.dx},${ex.y + o.dy}`);
          }));
          // If safer alternative exists with lower caution, use it; else take original (only path)
          if (safer) {
            const sc = aiCautionCost(ex, ex.floor, ex.x + safer.dx, ex.y + safer.dy);
            if (sc < stepCost) step = safer;
          }
        }
        break;
      }
    }
    if (aiApplyStep(ex, step)) return true;
  }

  // 2) Floor fully explored (or BFS failed): prefer stairs UP to clear higher floors
  if (ex.floor < FLOORS - 1) {
    if (aiTakeStairsIfNeeded(ex, ex.floor + 1)) return true;
    const up = aiFindTile(ex.floor, T.STAIRS_UP);
    if (up) {
      const step = aiBfsNextStep(
        ex.floor, ex.x, ex.y,
        (x, y) => x === up.x && y === up.y,
        lastDx, lastDy
      );
      if (aiApplyStep(ex, step)) return true;
    }
  }

  // 3) Top floor done (or can't go up): check lower floors for unvisited, path to stairs DOWN
  let lowerHasUnvis = false;
  for (let f = 0; f < ex.floor; f++) {
    if (aiFloorUnvisited(f, ex.visited).length) { lowerHasUnvis = true; break; }
  }
  // Also recheck any other floor with unvisited (e.g. skipped via pit)
  let anyOtherUnvis = lowerHasUnvis;
  if (!anyOtherUnvis) {
    for (let f = 0; f < FLOORS; f++) {
      if (f === ex.floor) continue;
      if (aiFloorUnvisited(f, ex.visited).length) { anyOtherUnvis = true; break; }
    }
  }
  if (anyOtherUnvis && ex.floor > 0) {
    if (aiTakeStairsIfNeeded(ex, ex.floor - 1)) return true;
    const down = aiFindTile(ex.floor, T.STAIRS_DOWN);
    if (down) {
      const step = aiBfsNextStep(
        ex.floor, ex.x, ex.y,
        (x, y) => x === down.x && y === down.y,
        lastDx, lastDy
      );
      if (aiApplyStep(ex, step)) return true;
    }
  }

  // 4) Everything explored: wander toward less-recent / stairs to recheck
  const stepWander = aiWanderStep(ex, lastDx, lastDy);
  if (aiApplyStep(ex, stepWander)) return true;

  ex.memory.stuck = (ex.memory.stuck || 0) + 1;
  for (const [dx, dy] of AI_DIRS.slice().sort(() => Math.random() - 0.5)) {
    if (aiApplyStep(ex, { dx, dy })) return true;
  }
  return false;
}

/** Plan a step toward a multi-floor goal (uses stairs). */
function aiPlanToward(ex, goal, lastDx, lastDy) {
  if (!goal) return null;
  if (goal.floor === ex.floor) {
    return aiBfsNextStep(
      ex.floor, ex.x, ex.y,
      (x, y) => x === goal.x && y === goal.y,
      lastDx, lastDy
    );
  }
  if (goal.floor > ex.floor) {
    const up = aiFindTile(ex.floor, T.STAIRS_UP);
    if (!up) return null;
    if (ex.x === up.x && ex.y === up.y) {
      // Will be handled by caller via tryMove — return a dummy that steps onto stairs
      // by moving to a neighbor then... actually return null and let stairs special-case.
      return null;
    }
    return aiBfsNextStep(
      ex.floor, ex.x, ex.y,
      (x, y) => x === up.x && y === up.y,
      lastDx, lastDy
    );
  }
  const down = aiFindTile(ex.floor, T.STAIRS_DOWN);
  if (!down) return null;
  if (ex.x === down.x && ex.y === down.y) return null;
  return aiBfsNextStep(
    ex.floor, ex.x, ex.y,
    (x, y) => x === down.x && y === down.y,
    lastDx, lastDy
  );
}

function aiWanderStep(ex, lastDx, lastDy) {
  // Prefer less-recent cells; soft-avoid unknown door/spawn danger; triggered = fine
  let best = null;
  let bestS = -1e9;
  const neighbors = aiNeighbors(ex.floor, ex.x, ex.y);
  for (const n of neighbors) {
    let s = Math.random() * 2;
    const t = tileAt(blueprint, ex.floor, n.x, n.y);
    if (t === T.STAIRS_UP || t === T.STAIRS_DOWN) s += 0.5;
    const nk = `${ex.floor},${n.x},${n.y}`;
    if (!ex.visited.has(nk)) s += 10;
    if (aiIsCellTriggered(ex, ex.floor, n.x, n.y)) s += 3; // known safe
    else s -= aiCautionCost(ex, ex.floor, n.x, n.y);
    // If only one neighbor (dead end / corridor), don't let caution block
    if (neighbors.length <= 1) s += 5;
    if (lastDx === -n.dx && lastDy === -n.dy) s -= 3;
    const recent = ex.memory.recent || [];
    const hits = recent.filter((k) => k === nk).length;
    s -= hits * 2;
    if (s > bestS) { bestS = s; best = { dx: n.dx, dy: n.dy }; }
  }
  return best;
}

/* ---------- Setup placement ---------- */
function placeAt(floor, x, y) {
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  if (!isPlaceable(blueprint, floor, x, y)) {
    setStatus($('setup-status'), '床のマスにだけ置けます（壁・ドア・階段は不可）', 'warn');
    return;
  }

  if (S.setupTool === 'erase') {
    if (house.chest && house.chest.floor === floor && house.chest.x === x && house.chest.y === y) {
      house.chest = null;
    }
    house.traps = house.traps.filter((t) => !(t.floor === floor && t.x === x && t.y === y));
    updateSetupHud();
    drawSetup();
    setStatus($('setup-status'), '消去しました', 'ok');
    return;
  }

  const occChest = house.chest && house.chest.floor === floor && house.chest.x === x && house.chest.y === y;
  const occTrap = house.traps.some((t) => t.floor === floor && t.x === x && t.y === y);
  if (occChest || occTrap) {
    setStatus($('setup-status'), 'そのマスにはすでに置いてあります', 'warn');
    return;
  }

  if (S.setupTool === 'chest') {
    house.chest = { floor, x, y };
    setStatus($('setup-status'), '宝箱を配置しました', 'ok');
    sfx('place');
    updateSetupHud();
    drawSetup();
    maybeCelebrateSetupComplete(house);
    return;
  }
  if (isTrapTool(S.setupTool)) {
    if (house.traps.length >= MAX_TRAPS) {
      setStatus($('setup-status'), `罠は最大${MAX_TRAPS}個まで`, 'warn');
      return;
    }
    const kind = S.setupTool === 'trap-pit' ? TRAP_PIT : TRAP_BOMB;
    house.traps.push({ floor, x, y, kind });
    const trapsFull = house.traps.length >= MAX_TRAPS;
    setStatus(
      $('setup-status'),
      trapsFull
        ? (house.chest
          ? `罠 ${MAX_TRAPS}/${MAX_TRAPS} — 罠は揃いました`
          : `罠 ${MAX_TRAPS}/${MAX_TRAPS} — 次は宝箱を配置`)
        : (kind === TRAP_PIT ? '落とし穴を配置しました' : '爆弾を配置しました'),
      'ok'
    );
    sfx('place');
    updateSetupHud();
    drawSetup();
    maybeCelebrateSetupComplete(house);
    return;
  }
  setStatus($('setup-status'), '上のボタンで宝箱か罠を選んでから床をタップ', 'warn');
}

function updateSetupHud() {
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  const chestOk = house.chest ? '✓' : '—';
  $('setup-chest-count').textContent = chestOk;
  $('setup-trap-count').textContent = `${house.traps.length}/${MAX_TRAPS}`;
  let title = 'あなたの家を設計';
  if (S.mode === 'com') title = 'COM対戦 — あなたの家を設計';
  else if (S.mode === 'local') {
    title = S.setupWhich === 'mine' ? '① あなたの家を設計' : '② 練習用・相手の家を設計';
  }
  $('setup-title').textContent = title;
  document.querySelectorAll('.floor-tab').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.floor) === S.setupFloor);
  });
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === S.setupTool);
  });
  const readyBtn = $('btn-ready');
  if (readyBtn) {
    const ok = !!(house.chest && house.traps.length >= MAX_TRAPS);
    readyBtn.disabled = !ok;
    readyBtn.textContent = ok ? '準備完了' : `準備完了（罠 ${house.traps.length}/${MAX_TRAPS}）`;
  }
}

function drawSetup() {
  const c = $('setup-canvas');
  if (!c) return;
  const ctx = layoutCanvas(c);
  const { w, h } = cssSize(c);
  const cs = cellSizeFor(c);
  const ox = Math.floor((w - COLS * cs) / 2);
  const oy = Math.floor((h - ROWS * cs) / 2);
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  drawHouse(ctx, blueprint, house, S.setupFloor, {
    showChest: true,
    showTraps: true,
    triggeredTraps: new Set(),
    ox, oy, cellSize: cs,
  });
  c._map = { ox, oy, cs, w, h };
}

function setupCanvasTap(e) {
  const c = $('setup-canvas');
  if (!c) return;
  if (!c._map || !c._map.cs) drawSetup();
  if (!c._map || !c._map.cs) return;
  const rect = c.getBoundingClientRect();
  const t = (e.changedTouches && e.changedTouches[0])
    || (e.touches && e.touches[0])
    || e;
  if (!t || t.clientX == null) return;
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;
  const { ox, oy, cs } = c._map;
  const x = Math.floor((mx - ox) / cs);
  const y = Math.floor((my - oy) / cs);
  if (x >= 0 && y >= 0 && x < COLS && y < ROWS) {
    placeAt(S.setupFloor, x, y);
  } else {
    setStatus($('setup-status'), 'マップのマスをタップしてください', 'warn');
  }
}

/* ---------- Match rendering (visibility rules) ----------
 * Top (opponent in YOUR house): show YOUR chest + ALL armed traps (incl. pits).
 * Bottom (you in THEIR house): never show untriggered chest/traps;
 *   only triggered traps (spent hole/mark). Chest only after found/end.
 */
function redrawMatchView(ctx, canvas, explorer, houseShown, showSecrets, triggered, isOpponentView) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = isOpponentView ? '#1a1020' : '#101820';
  ctx.fillRect(0, 0, w, h);

  const focus = S.slowMoFocus;
  const thisFocus = (isOpponentView && focus === 'top') || (!isOpponentView && focus === 'bot');
  const hero = heroFocusActive(isOpponentView);

  const cs = cellSizeFor(canvas);
  const ox = Math.floor((w - COLS * cs) / 2);
  const oy = Math.floor((h - ROWS * cs) / 2) + 6;

  // Camera: zoom toward hero cell (or soft center zoom in slow-mo)
  let zoomed = false;
  if (hero || (S.slowMo && thisFocus)) {
    const fx = hero ? hero.x : explorer.x;
    const fy = hero ? hero.y : explorer.y;
    const cx = ox + (fx + 0.5) * cs;
    const cy = oy + (fy + 0.5) * cs;
    const pulse = Math.sin((S.slowMoPulse || performance.now() * 0.01) * 0.01);
    const lethal = !!(hero && (hero.lethal || (S.ended && (S.endReason === 'hp_me' || S.endReason === 'hp_foe'))));
    const zoom = hero
      ? (lethal ? 1.85 + 0.14 * pulse : 1.55 + 0.12 * pulse)
      : 1.1 + 0.05 * pulse;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
    zoomed = true;
  }

  const drawFloor = hero ? hero.floor : explorer.floor;

  // Base tiles only — never leak secrets via drawHouse items
  drawHouse(ctx, blueprint, null, drawFloor, {
    showChest: false,
    showTraps: false,
    ox, oy, cellSize: cs,
  });

  const skipX = hero ? hero.x : -1;
  const skipY = hero ? hero.y : -1;
  const skipFloor = hero ? hero.floor : -1;

  if (houseShown) {
    if (showSecrets) {
      drawHouseItems(ctx, houseShown, drawFloor, triggered, true, true, ox, oy, cs, skipX, skipY, skipFloor);
    } else {
      const showChest = !!(explorer.foundChest || S.revealSecrets || (hero && hero.kind === 'chest'));
      drawHouseItems(ctx, houseShown, drawFloor, triggered, false, showChest, ox, oy, cs, skipX, skipY, skipFloor);
    }
  }

  const color = isOpponentView ? COLORS.player2 : COLORS.player1;
  const pulse = S.time * 0.008;

  if (hero) {
    // Giant character + chest/trap at the hit cell
    const hx = ox + hero.x * cs + cs / 2;
    const hy = oy + hero.y * cs + cs / 2;
    const lethal = !!(hero.lethal || (S.ended && (S.endReason === 'hp_me' || S.endReason === 'hp_foe')));
    const base = lethal ? 2.85 : 2.25;
    const big = base + 0.15 * Math.sin((S.slowMoPulse || performance.now() * 0.01) * 0.012);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(big, big);
    // Soft glow behind
    ctx.fillStyle = hero.kind === 'chest' ? 'rgba(255, 210, 80, 0.35)' : 'rgba(255, 60, 60, 0.3)';
    ctx.beginPath();
    ctx.arc(0, 0, cs * 0.7, 0, Math.PI * 2);
    ctx.fill();
    if (hero.kind === 'chest') {
      drawChestSprite(ctx, -cs / 2, -cs / 2, cs);
    } else {
      const tr = { floor: hero.floor, x: hero.x, y: hero.y, kind: hero.trapKind || TRAP_BOMB };
      drawTrapSprite(ctx, tr, true, -cs / 2, -cs / 2, cs);
    }
    // Character slightly above the object
    drawPlayer(ctx, 0, 0, color, -cs / 2, -cs / 2 - cs * 0.08, cs, pulse);
    ctx.restore();
  } else {
    drawPlayer(ctx, explorer.x, explorer.y, color, ox, oy, cs, pulse);
  }

  if (zoomed) ctx.restore();

  // HUD in screen space
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, 30);
  ctx.fillStyle = '#ffe8a3';
  ctx.font = 'bold 12px "Hiragino Sans", "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const title = isOpponentView ? '▲ 相手があなたの家を探索中' : '▼ あなたが相手の家を探索中';
  ctx.fillText(title, 8, 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.fillText(floorLabel(drawFloor), w - 8, 15);

  for (const f of S.fx) {
    if (f.view !== (isOpponentView ? 'top' : 'bot')) continue;
    const alpha = Math.max(0, 1 - f.age / f.life);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.font = `bold ${18 + f.age * 0.04}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(f.text, w / 2, Math.max(50, h * 0.4 - f.age * 0.05));
    ctx.globalAlpha = 1;
  }

  if (hero || (S.slowMo && thisFocus)) {
    ctx.strokeStyle = 'rgba(255, 224, 138, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 200, 80, 0.08)';
    ctx.fillRect(0, 0, w, h);
  }
}

function drawHouseItems(ctx, houseData, floor, triggered, showAllTraps, showChest, ox, oy, cs, skipX = -1, skipY = -1, skipFloor = -1) {
  for (const raw of houseData.traps) {
    const tr = normalizeTrap(raw);
    if (!tr || tr.floor !== floor) continue;
    if (tr.floor === skipFloor && tr.x === skipX && tr.y === skipY) continue;
    const key = `${tr.floor},${tr.x},${tr.y}`;
    const isTrig = triggered.has(key);
    if (!showAllTraps && !isTrig) continue;
    drawTrapSprite(ctx, tr, isTrig, ox + tr.x * cs, oy + tr.y * cs, cs);
  }
  if (showChest && houseData.chest && houseData.chest.floor === floor) {
    const c = houseData.chest;
    if (!(c.floor === skipFloor && c.x === skipX && c.y === skipY)) {
      drawChestSprite(ctx, ox + c.x * cs, oy + c.y * cs, cs);
    }
  }
}

function addFx(view, text, color, life = 1000) {
  S.fx.push({ view, text, color, age: 0, life });
}

/**
 * Dramatic enlarge of character + chest/trap at the hit cell.
 * @param {{view:'top'|'bot', kind:'chest'|'trap', x:number, y:number, floor:number, trapKind?:string, ms?:number, px?:number, py?:number}} opts
 */
function startHeroFocus(opts) {
  const ms = opts.ms == null ? 1600 : opts.ms;
  S.heroFocus = {
    view: opts.view,
    kind: opts.kind,
    x: opts.x,
    y: opts.y,
    floor: opts.floor,
    trapKind: opts.trapKind || TRAP_BOMB,
    px: opts.px != null ? opts.px : opts.x,
    py: opts.py != null ? opts.py : opts.y,
    lethal: !!opts.lethal,
    until: performance.now() + ms,
  };
}

function heroFocusActive(isOpponentView) {
  const h = S.heroFocus;
  if (!h || performance.now() >= h.until) return null;
  const view = isOpponentView ? 'top' : 'bot';
  return h.view === view ? h : null;
}

function updateHpBars() {
  $('hp-top').innerHTML = heartsHtml(S.foeHp, MAX_HP);
  $('hp-bot').innerHTML = heartsHtml(S.myHp, MAX_HP);
}

/**
 * @param {'me'|'foe'} winner
 * @param {'chest_me'|'chest_foe'|'hp_me'|'hp_foe'|string} reason
 */
function climaxEventTitle(reason) {
  switch (reason) {
    case 'chest_me': return '宝箱ゲット！';
    case 'chest_foe': return '宝箱を取られた！';
    case 'hp_foe': return '罠で撃破！';
    case 'hp_me': return '体力ゼロ！';
    default: return '対戦終了';
  }
}

function showClimaxBanner(iWon, reasonText, eventTitle, bannerIcon) {
  const banner = $('end-banner');
  if (!banner) return;
  banner.classList.remove('fade-out');
  banner.classList.add('show', iWon ? 'win' : 'lose');
  const chip = $('end-banner-chip');
  if (chip) chip.textContent = iWon ? 'あなたの勝ち' : 'あなたの負け';
  $('end-banner-icon').textContent = bannerIcon;
  const ev = $('end-banner-event');
  if (ev) ev.textContent = eventTitle;
  $('end-banner-text').textContent = iWon ? '勝ち！' : '負け…';
  $('end-banner-detail').textContent = reasonText;
}

function endGame(winner, reason) {
  if (S.ended) return;
  S.ended = true;
  S.winner = winner;
  S.endReason = reason || '';
  S.revealSecrets = true;
  S.holdDir = null;

  const iWon = winner === 'me';
  const reasonText = endReasonLabel(reason, iWon);
  const eventTitle = climaxEventTitle(reason);
  const bannerIcon = reasonIcon(reason);
  const flashBot = reason === 'chest_me' || reason === 'hp_me';
  const focusView = flashBot ? 'bot' : 'top';
  const isLethalTrap = reason === 'hp_me' || reason === 'hp_foe';

  const banner = $('end-banner');
  const overlay = $('result-overlay');
  if (overlay) overlay.classList.remove('show', 'win', 'lose');
  if (banner) banner.classList.remove('show', 'fade-out', 'win', 'lose');

  // Last-life trap death: keep hero focus alive + stronger slow-mo BEFORE the card
  if (isLethalTrap) {
    if (S.heroFocus && S.heroFocus.kind === 'trap') {
      S.heroFocus.lethal = true;
      S.heroFocus.until = performance.now() + 6500;
      S.heroFocus.view = focusView;
    } else if (S.lastTrapHit) {
      const t = S.lastTrapHit;
      startHeroFocus({
        view: focusView,
        kind: 'trap',
        x: t.x,
        y: t.y,
        floor: t.floor,
        trapKind: t.kind,
        lethal: true,
        ms: 6500,
      });
    }
  }

  S.slowMo = true;
  S.timeScale = isLethalTrap ? 0.1 : 0.15;
  S.slowMoFocus = focusView;
  S.slowMoPulse = 0;
  sfx('slowMo');
  if (reason === 'chest_me' || reason === 'chest_foe') sfx('chest');
  else sfx('hurt');
  const match = $('screen-match');
  if (match) {
    match.classList.add('slow-mo');
    match.classList.toggle('slow-mo-bot', flashBot);
    match.classList.toggle('slow-mo-top', !flashBot);
  }

  addFx(focusView, eventTitle, '#ffe08a', 3500);
  // Softer flash so enlarged trap/char stays visible
  flashOverlay($(flashBot ? 'flash-bot' : 'flash-top'), eventTitle, isLethalTrap ? 900 : 2000);

  if (S.mode && S.mode.startsWith('online') && S.net) {
    S.net.send({
      type: 'gameover',
      winner: winner === 'me' ? 'host_or_self' : 'other',
      reason,
      from: S.mode,
    });
  }

  clearTimeout(S._endTimer);
  clearTimeout(S._slowTimer);
  clearTimeout(S._bannerTimer);

  if (isLethalTrap) {
    // Phase 1: enlarge trap+char (~3.2s)
    // Phase 2: climax card hold (~3s)
    // Phase 3: result
    S._bannerTimer = setTimeout(() => {
      showClimaxBanner(iWon, reasonText, eventTitle, bannerIcon);
    }, 3200);
    S._slowTimer = setTimeout(() => {
      S.slowMo = false;
      S.timeScale = 1;
      if (match) match.classList.remove('slow-mo', 'slow-mo-bot', 'slow-mo-top');
      sfx(iWon ? 'win' : 'lose');
      if (banner) {
        banner.classList.add('fade-out');
        setTimeout(() => banner.classList.remove('show', 'fade-out', 'win', 'lose'), 350);
      }
      showResultScreen(iWon, reasonText);
    }, 6200);
  } else {
    showClimaxBanner(iWon, reasonText, eventTitle, bannerIcon);
    S._slowTimer = setTimeout(() => {
      S.slowMo = false;
      S.timeScale = 1;
      if (match) match.classList.remove('slow-mo', 'slow-mo-bot', 'slow-mo-top');
      sfx(iWon ? 'win' : 'lose');
      if (banner) {
        banner.classList.add('fade-out');
        setTimeout(() => banner.classList.remove('show', 'fade-out', 'win', 'lose'), 350);
      }
      showResultScreen(iWon, reasonText);
    }, 2800);
  }
}

function endReasonLabel(reason, iWon) {
  switch (reason) {
    case 'chest_me':
      return '相手の家の宝箱を見つけた！';
    case 'chest_foe':
      return '相手に自分の宝箱を取られた…';
    case 'hp_foe':
      return '罠で相手の体力をゼロにした！';
    case 'hp_me':
      return '罠で体力がゼロになった…';
    default:
      return iWon ? '対戦に勝利しました' : '対戦に敗北しました';
  }
}

function reasonIcon(reason) {
  if (reason === 'chest_me' || reason === 'chest_foe') return '💎';
  if (reason === 'hp_me' || reason === 'hp_foe') return '💔';
  return '🏁';
}

function drawResultChestReveal(chest, reason) {
  const wrap = $('result-chest-reveal');
  const loc = $('result-chest-loc');
  const canvas = $('result-chest-canvas');
  const label = wrap && wrap.querySelector('.result-chest-label');
  if (!wrap || !canvas || !chest) {
    if (wrap) {
      wrap.classList.add('hidden');
      wrap.classList.remove('visible');
    }
    return;
  }
  wrap.classList.remove('hidden');
  wrap.classList.add('visible');
  if (label) {
    label.textContent = reason === 'hp_me'
      ? '体力ゼロ…相手が仕掛けた宝箱はここ'
      : '相手が仕掛けた宝箱';
  }
  if (loc) {
    loc.textContent = `${floorLabel(chest.floor)} ／ マス (${chest.x + 1}, ${chest.y + 1})`;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Parent may still be laying out — fall back to fixed size so map always draws
  let cssW = canvas.clientWidth || wrap.clientWidth || 260;
  if (cssW < 80) cssW = 260;
  const cssH = Math.max(120, Math.floor(cssW * 0.7));
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, cssW, cssH);

  const cs = Math.max(1, Math.floor(Math.min(cssW / COLS, cssH / ROWS)));
  const ox = Math.floor((cssW - COLS * cs) / 2);
  const oy = Math.floor((cssH - ROWS * cs) / 2);
  drawHouse(ctx, blueprint, null, chest.floor, {
    showChest: false,
    showTraps: false,
    ox, oy, cellSize: cs,
  });
  ctx.fillStyle = 'rgba(255, 210, 80, 0.28)';
  ctx.fillRect(ox + chest.x * cs, oy + chest.y * cs, cs, cs);
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 2;
  ctx.strokeRect(ox + chest.x * cs + 1, oy + chest.y * cs + 1, cs - 2, cs - 2);
  drawChestSprite(ctx, ox + chest.x * cs, oy + chest.y * cs, cs);
}

/** On ANY loss (宝箱を取られた／体力ゼロなど), show opponent chest location. */
function showResultScreen(iWon, reasonText) {
  const overlay = $('result-overlay');
  const title = $('result-title');
  const reasonEl = $('result-reason');
  const sub = $('result-sub');
  const chestReveal = $('result-chest-reveal');
  if (!overlay) return;
  overlay.classList.add('show', iWon ? 'win' : 'lose');
  overlay.classList.remove(iWon ? 'lose' : 'win');
  if (iWon) {
    title.textContent = '勝利！';
    title.className = 'win';
    sub.textContent = 'もう一度挑戦するか、タイトルへ戻れます';
    if (chestReveal) {
      chestReveal.classList.add('hidden');
      chestReveal.classList.remove('visible');
    }
  } else {
    title.textContent = '敗北…';
    title.className = 'lose';
    sub.textContent = '罠の置き方や探索ルートを変えて再挑戦！';
    const chest = S.theirHouse && S.theirHouse.chest;
    const reason = S.endReason || '';
    if (chest && chestReveal) {
      chestReveal.classList.remove('hidden');
      chestReveal.classList.add('visible');
      // Double rAF so overlay layout is ready (incl. hp_me after long climax)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => drawResultChestReveal(chest, reason));
      });
    } else if (chestReveal) {
      chestReveal.classList.add('hidden');
      chestReveal.classList.remove('visible');
    }
  }
  if (reasonEl) reasonEl.textContent = '理由：' + reasonText;
}

/* ---------- Match loop ---------- */
function onTrapHit(who, tr) {
  const kind = tr.kind === TRAP_PIT ? TRAP_PIT : TRAP_BOMB;
  const isPit = kind === TRAP_PIT;
  const dmg = isPit ? PIT_DAMAGE : BOMB_DAMAGE;
  const view = who === 'me' ? 'bot' : 'top';
  const ex = who === 'me' ? S.me : S.foe;
  const willEnd = who === 'me' ? S.myHp <= dmg : S.foeHp <= dmg;

  S.lastTrapHit = { who, floor: tr.floor, x: tr.x, y: tr.y, kind };

  startHeroFocus({
    view,
    kind: 'trap',
    x: tr.x,
    y: tr.y,
    floor: tr.floor,
    trapKind: kind,
    px: ex ? ex.x : tr.x,
    py: ex ? ex.y : tr.y,
    lethal: willEnd,
    ms: willEnd ? 6500 : 1400,
  });

  if (who === 'me') {
    S.myHp = Math.max(0, Math.round((S.myHp - dmg) * 2) / 2);
    if (isPit) {
      // Delay drop so the enlarge shot shows char + pit together
      clearTimeout(S._pitTimer);
      const victim = S.me;
      S._pitTimer = setTimeout(() => {
        if (victim) applyPitfallDrop(victim);
        if (S.mode && S.mode.startsWith('online') && S.net && victim) {
          S.net.send({
            type: 'pos',
            floor: victim.floor,
            x: victim.x,
            y: victim.y,
            hp: S.myHp,
          });
        }
      }, willEnd ? 2800 : 900);
      addFx('bot', '落とし穴！', '#aa66ff');
      flashOverlay($('flash-bot'), '🕳 落とし穴！', 700);
      if (S.myHp > 0) sfx('pit');
    } else {
      addFx('bot', '爆弾だ！', '#ff4444');
      flashOverlay($('flash-bot'), '💥 爆弾！', 600);
      if (S.myHp > 0) sfx('trap');
    }
    if (S.myHp <= 0) endGame('foe', 'hp_me');
  } else {
    S.foeHp = Math.max(0, Math.round((S.foeHp - dmg) * 2) / 2);
    if (isPit && S.foe) {
      clearTimeout(S._pitTimer);
      const victim = S.foe;
      S._pitTimer = setTimeout(() => {
        if (victim) applyPitfallDrop(victim);
      }, willEnd ? 2800 : 900);
      addFx('top', '落とし穴作動！', '#aa66ff');
      flashOverlay($('flash-top'), '🕳 落とし穴！', 700);
      if (S.foeHp > 0) sfx('pit');
    } else {
      addFx('top', '爆弾作動！', '#ffaa00');
      flashOverlay($('flash-top'), '💥 爆弾作動！', 600);
      if (S.foeHp > 0) sfx('trap');
    }
    if (S.foeHp <= 0) endGame('me', 'hp_foe');
  }
  updateHpBars();
  if (S.mode && S.mode.startsWith('online') && S.net) {
    const reportEx = who === 'me' ? S.me : S.foe;
    S.net.send({
      type: 'trap',
      who,
      floor: tr.floor,
      x: tr.x,
      y: tr.y,
      kind,
      myHp: S.myHp,
      foeHp: S.foeHp,
      // Pit drop is delayed locally; position updates after drop
      newFloor: (!isPit && reportEx) ? reportEx.floor : tr.floor,
      newX: (!isPit && reportEx) ? reportEx.x : tr.x,
      newY: (!isPit && reportEx) ? reportEx.y : tr.y,
    });
  }
}

function onChestFound(who) {
  const ex = who === 'me' ? S.me : S.foe;
  const chest = ex && ex.house && ex.house.chest;
  if (chest) {
    startHeroFocus({
      view: who === 'me' ? 'bot' : 'top',
      kind: 'chest',
      x: chest.x,
      y: chest.y,
      floor: chest.floor,
      px: ex.x,
      py: ex.y,
      ms: 3000,
    });
  }
  if (who === 'me') {
    addFx('bot', '宝箱ゲット！', '#ffd700');
    flashOverlay($('flash-bot'), '💎 宝箱発見！', 1600);
    endGame('me', 'chest_me');
  } else {
    addFx('top', '相手が宝箱を発見！', '#ffd700');
    flashOverlay($('flash-top'), '💎 相手が発見！', 1600);
    endGame('foe', 'chest_foe');
  }
  if (S.mode && S.mode.startsWith('online') && S.net) {
    S.net.send({ type: 'chest', who });
  }
}

function applyMoveFromInput() {
  if (S.ended || !S.me) return;
  if (!S.holdDir) return;
  if (S.moveCooldown > 0) return;
  const map = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const d = map[S.holdDir];
  if (!d) return;
  if (tryMove(S.me, d[0], d[1])) {
    S.moveCooldown = 140;
    checkHazards(S.me, S.myTriggered, (tr) => onTrapHit('me', tr), () => onChestFound('me'));
    syncPos();
  }
}

function syncPos() {
  if (S.mode && S.mode.startsWith('online') && S.net && S.me) {
    S.net.send({
      type: 'pos',
      floor: S.me.floor,
      x: S.me.x,
      y: S.me.y,
      hp: S.myHp,
    });
  }
}

let aiTimer = 0;

function tick(ts) {
  animId = requestAnimationFrame(tick);
  const rawDt = Math.min(50, ts - (lastTs || ts));
  lastTs = ts;
  const scale = S.slowMo ? (S.timeScale || 0.18) : 1;
  const dt = rawDt * scale;
  S.time += dt;
  if (S.slowMo) S.slowMoPulse = (S.slowMoPulse || 0) + rawDt;

  if (S.phase !== 'match') return;

  if (!S.ended) {
    S.moveCooldown = Math.max(0, S.moveCooldown - dt);
    applyMoveFromInput();

    if ((S.mode === 'local' || S.mode === 'com') && S.foe) {
      aiTimer += dt;
      if (aiTimer > (S.mode === 'com' ? 420 : 380)) {
        aiTimer = 0;
        aiStep(S.foe);
        checkHazards(S.foe, S.foeTriggered, (tr) => onTrapHit('foe', tr), () => onChestFound('foe'));
      }
    }
  }

  // FX age in sim-time so they hang during slow-mo
  for (const f of S.fx) f.age += dt;
  S.fx = S.fx.filter((f) => f.age < f.life);

  if (ctxTop && S.foe) {
    redrawMatchView(ctxTop, canvTop, S.foe, S.myHouse, true, S.foeTriggered, true);
  }
  if (ctxBot && S.me) {
    redrawMatchView(ctxBot, canvBot, S.me, S.theirHouse, false, S.myTriggered, false);
  }
}

/* ---------- Networking handlers ---------- */
function handleNetMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'house':
      S.theirHouse = parseHouse(msg.house);
      setStatus($('net-status'), '相手の家データを受信しました', 'ok');
      maybeStartOnlineMatch();
      break;
    case 'ready':
      S.peerReady = true;
      setStatus($('net-status'), '相手の準備完了', 'ok');
      maybeStartOnlineMatch();
      break;
    case 'pos':
      if (S.foe) {
        S.foe.floor = msg.floor;
        S.foe.x = msg.x;
        S.foe.y = msg.y;
      }
      break;
    case 'trap':
      if (msg.who === 'me') {
        // Peer hit a trap in our house
        const key = `${msg.floor},${msg.x},${msg.y}`;
        S.foeTriggered.add(key);
        S.foeHp = typeof msg.myHp === 'number' ? msg.myHp : Math.max(0, Math.round((S.foeHp - (msg.kind === TRAP_PIT ? PIT_DAMAGE : BOMB_DAMAGE)) * 2) / 2);
        const willEnd = S.foeHp <= 0;
        S.lastTrapHit = {
          who: 'foe',
          floor: msg.floor,
          x: msg.x,
          y: msg.y,
          kind: msg.kind === TRAP_PIT ? TRAP_PIT : TRAP_BOMB,
        };
        startHeroFocus({
          view: 'top',
          kind: 'trap',
          x: msg.x,
          y: msg.y,
          floor: msg.floor,
          trapKind: msg.kind === TRAP_PIT ? TRAP_PIT : TRAP_BOMB,
          lethal: willEnd,
          ms: willEnd ? 6500 : 1400,
        });
        if (msg.kind === TRAP_PIT) {
          addFx('top', '落とし穴作動！', '#aa66ff');
          // Floor drop arrives via later pos sync after peer's delayed drop
        } else {
          addFx('top', '爆弾作動！', '#ffaa00');
        }
        updateHpBars();
        if (S.foeHp <= 0) endGame('me', 'hp_foe');
      }
      break;
    case 'chest':
      if (msg.who === 'me') {
        const chest = S.myHouse && S.myHouse.chest;
        if (chest) {
          startHeroFocus({
            view: 'top',
            kind: 'chest',
            x: chest.x,
            y: chest.y,
            floor: chest.floor,
            ms: 3000,
          });
        }
        endGame('foe', 'chest_foe');
      }
      break;
    case 'gameover':
      break;
    default:
      break;
  }
}

function maybeStartOnlineMatch() {
  if (S.iAmReady && S.peerReady && S.theirHouse && S.theirHouse.chest) {
    startMatch();
  }
}

/* ---------- Flow ---------- */
function goTitle() {
  S.phase = 'title';
  if (S.net) { S.net.destroy(); S.net = null; }
  showScreen('screen-title');
  cancelAnimationFrame(animId);
}

function startSetup() {
  S.phase = 'setup';
  S.myHouse = createEmptyHouseData();
  S.theirHouse = createEmptyHouseData();
  S.setupFloor = 0;
  S.setupTool = 'chest';
  S.setupWhich = 'mine';
  S.localStep = 0;
  S.iAmReady = false;
  S.peerReady = false;
  S.revealSecrets = false;
  S._celebratedSetup = false;
  clearTimeout(S._setupDoneTimer);
  const doneBanner = $('setup-done-banner');
  if (doneBanner) doneBanner.classList.remove('show', 'fade-out');
  const readyBtn = $('btn-ready');
  if (readyBtn) {
    readyBtn.disabled = true;
    readyBtn.textContent = `準備完了（罠 0/${MAX_TRAPS}）`;
  }
  showScreen('screen-setup');
  updateSetupHud();
  requestAnimationFrame(() => {
    drawSetup();
    updateSetupHud(); // again after paint — avoid stale enabled state from last match
  });
  setStatus($('setup-status'), `マスをタップして配置。宝箱1つ＋罠${MAX_TRAPS}個必須。`, '');
}

function isSetupFullyPlaced(house) {
  return !!(house && house.chest && house.traps && house.traps.length >= MAX_TRAPS);
}

function maybeCelebrateSetupComplete(house) {
  if (!isSetupFullyPlaced(house)) return;
  if (S._celebratedSetup) return; // once per setup house
  S._celebratedSetup = true;
  setStatus($('setup-status'), `仕掛け完了！ 宝箱＋罠${MAX_TRAPS}個`, 'ok');
  showSetupDone(
    `${setupDoneSummary(house)}\n準備完了で対戦へ`,
    null
  );
}

function setupDoneSummary(house) {
  const traps = (house && house.traps) ? house.traps.length : 0;
  const bombs = (house && house.traps) ? house.traps.filter((t) => t.kind !== TRAP_PIT).length : 0;
  const pits = traps - bombs;
  const parts = [];
  if (house && house.chest) parts.push('宝箱OK');
  parts.push(`罠 ${traps}/${MAX_TRAPS}`);
  if (bombs) parts.push(`爆弾${bombs}`);
  if (pits) parts.push(`落とし穴${pits}`);
  return parts.join(' ／ ');
}

function showSetupDone(detail, thenFn) {
  const banner = $('setup-done-banner');
  const detailEl = $('setup-done-detail');
  const titleEl = banner && banner.querySelector('.setup-done-title');
  if (titleEl) titleEl.textContent = '仕掛け完了！';
  if (detailEl) detailEl.textContent = detail || '';
  if (banner) {
    banner.classList.remove('fade-out');
    banner.classList.add('show');
  }
  try { sfx('ready'); } catch (_) {}
  clearTimeout(S._setupDoneTimer);
  S._setupDoneTimer = setTimeout(() => {
    if (banner) {
      banner.classList.add('fade-out');
      setTimeout(() => banner.classList.remove('show', 'fade-out'), 320);
    }
    if (typeof thenFn === 'function') thenFn();
  }, 1600);
}

function onReadySetup() {
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  const v = validateHouse(house, blueprint);
  if (!v.ok) {
    setStatus($('setup-status'), v.msg, 'warn');
    return;
  }

  if (S.mode === 'com') {
    S.theirHouse = generateComHouse(blueprint);
    setStatus($('setup-status'), 'COMが家を設計しました…', 'ok');
    try { sfx('ready'); } catch (_) {}
    startMatch();
    return;
  }

  if (S.mode === 'local') {
    if (S.setupWhich === 'mine') {
      S.setupWhich = 'theirs';
      S.localStep = 1;
      S.setupFloor = 0;
      S.setupTool = 'chest';
      updateSetupHud();
      drawSetup();
      setStatus($('setup-status'), '次に相手（練習用）の家を設計してください', 'ok');
      return;
    }
    try { sfx('ready'); } catch (_) {}
    startMatch();
    return;
  }

  S.iAmReady = true;
  if (S.net) {
    S.net.send({ type: 'house', house: S.myHouse });
    S.net.send({ type: 'ready' });
  }
  setStatus($('setup-status'), '準備完了 — 相手を待っています…', 'ok');
  $('btn-ready').disabled = true;
  try { sfx('ready'); } catch (_) {}
  maybeStartOnlineMatch();
}

function startMatch() {
  S.phase = 'match';
  S.ended = false;
  S.winner = null;
  S.revealSecrets = false;
  S.myHp = MAX_HP;
  S.foeHp = MAX_HP;
  S.myTriggered = new Set();
  S.foeTriggered = new Set();
  S.fx = [];
  S.holdDir = null;
  S.moveCooldown = 0;
  aiTimer = 0;

  // Normalize trap kinds (migration for any old data)
  S.myHouse = parseHouse(S.myHouse);
  S.theirHouse = parseHouse(S.theirHouse);

  S.me = makeExplorer(S.theirHouse, 'me');
  S.foe = makeExplorer(S.myHouse, 'foe');

  showScreen('screen-match');
  $('result-overlay').classList.remove('show', 'win', 'lose');
  const rcr = $('result-chest-reveal');
  if (rcr) { rcr.classList.add('hidden'); rcr.classList.remove('visible'); }
  const eb = $('end-banner');
  if (eb) eb.classList.remove('show', 'fade-out', 'win', 'lose');
  clearTimeout(S._endTimer);
  clearTimeout(S._slowTimer);
  S.slowMo = false;
  S.timeScale = 1;
  S.heroFocus = null;
  S.lastTrapHit = null;
  clearTimeout(S._pitTimer);
  clearTimeout(S._bannerTimer);
  clearTimeout(S._setupDoneTimer);
  const matchEl = $('screen-match');
  if (matchEl) matchEl.classList.remove('slow-mo', 'slow-mo-bot', 'slow-mo-top');

  canvTop = $('canvas-top');
  canvBot = $('canvas-bot');
  resizeCanvases();
  updateHpBars();

  lastTs = 0;
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(tick);
}

/* ---------- Online room UI ---------- */
async function createRoom() {
  setStatus($('net-status'), 'PeerJS読み込み中…', '');
  showScreen('screen-lobby');
  $('lobby-code-wrap').classList.remove('hidden');
  $('lobby-join-wrap').classList.add('hidden');
  $('room-code-display').textContent = '------';
  try {
    S.net = new NetSession();
    S.net.onStatus = (m) => setStatus($('net-status'), m, '');
    S.net.onMessage = handleNetMessage;
    S.net.onPeerLost = () => setStatus($('net-status'), '相手が切断しました', 'warn');
    S.mode = 'online-host';
    const code = await S.net.host();
    $('room-code-display').textContent = code;
    setStatus($('net-status'), 'この6桁コードを相手に伝えてください', 'ok');
    const check = setInterval(() => {
      if (S.net && S.net.conn && S.net.conn.open) {
        clearInterval(check);
        startSetup();
      }
    }, 200);
  } catch (e) {
    setStatus($('net-status'), '接続失敗: ' + (e.message || e) + ' — ローカル練習を使ってください', 'warn');
  }
}

async function joinRoom() {
  const code = normalizeRoomCode($('join-code-input').value);
  if (!isValidRoomCode(code)) {
    setStatus($('net-status'), '6桁の数字のルームコードを入力', 'warn');
    return;
  }
  setStatus($('net-status'), '接続中…', '');
  try {
    S.net = new NetSession();
    S.net.onStatus = (m) => setStatus($('net-status'), m, '');
    S.net.onMessage = handleNetMessage;
    S.net.onPeerLost = () => setStatus($('net-status'), '相手が切断しました', 'warn');
    S.mode = 'online-guest';
    await S.net.join(code);
    startSetup();
  } catch (e) {
    setStatus($('net-status'), '参加失敗: ' + (e.message || e), 'warn');
  }
}

function showJoinLobby() {
  showScreen('screen-lobby');
  $('lobby-code-wrap').classList.add('hidden');
  $('lobby-join-wrap').classList.remove('hidden');
  setStatus($('net-status'), 'ホストの6桁ルームコードを入力', '');
  S.mode = 'online-guest';
}

/* ---------- Input binding ---------- */
function bindControls() {
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    const dir = btn.dataset.dir;
    bindHold(
      btn,
      () => { S.holdDir = dir; },
      () => { if (S.holdDir === dir) S.holdDir = null; }
    );
  });

  const keyMap = {
    ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r',
    w: 'u', W: 'u', s: 'd', S: 'd', a: 'l', A: 'l', d: 'r', D: 'r',
  };
  window.addEventListener('keydown', (e) => {
    if (keyMap[e.key] && S.phase === 'match') {
      e.preventDefault();
      S.holdDir = keyMap[e.key];
    }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.key] && S.holdDir === keyMap[e.key]) S.holdDir = null;
  });

  bindTap($('btn-create'), () => { unlockAudio(); sfx('tap'); createRoom(); });
  bindTap($('btn-join'), () => { unlockAudio(); sfx('tap'); showJoinLobby(); });
  bindTap($('btn-com'), () => {
    unlockAudio();
    sfx('tap');
    S.mode = 'com';
    startSetup();
  });
  bindTap($('btn-join-go'), () => joinRoom());
  bindTap($('btn-lobby-back'), () => goTitle());

  document.querySelectorAll('.floor-tab').forEach((btn) => {
    bindTap(btn, () => {
      S.setupFloor = Number(btn.dataset.floor);
      updateSetupHud();
      drawSetup();
    });
  });
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    const select = (e) => {
      if (e) e.preventDefault();
      S.setupTool = btn.dataset.tool || 'chest';
      updateSetupHud();
      const label = btn.textContent.trim();
      setStatus($('setup-status'), `${label} を選択 — 床をタップして配置`, 'ok');
      sfx('tap');
    };
    bindTap(btn, select);
    btn.addEventListener('pointerdown', select, { passive: false });
  });
  bindTap($('btn-ready'), () => onReadySetup());
  bindTap($('btn-setup-back'), () => goTitle());

  const sc = $('setup-canvas');
  let lastPlaceTs = 0;
  const onPlace = (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastPlaceTs < 80) return; // debounce click+touch double fire
    lastPlaceTs = now;
    setupCanvasTap(e);
  };
  sc.addEventListener('pointerdown', onPlace, { passive: false });
  sc.addEventListener('click', onPlace);
  sc.addEventListener('touchend', onPlace, { passive: false });

  // Digits-only on join input
  const joinInput = $('join-code-input');
  if (joinInput) {
    joinInput.addEventListener('input', () => {
      joinInput.value = joinInput.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  bindTap($('btn-again'), () => {
    if (S.mode === 'local' || S.mode === 'com') {
      startSetup();
    } else {
      goTitle();
    }
  });
  bindTap($('btn-title'), () => goTitle());

  window.addEventListener('resize', () => {
    resizeCanvases();
    if (S.phase === 'setup') drawSetup();
  });
}

export async function init() {
  lockTouch($('app'));
  let lastTouch = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouch <= 300) e.preventDefault();
      lastTouch = now;
    },
    { passive: false }
  );

  bindControls();
  showScreen('screen-title');
  loadMutePref();
  syncMuteButton();

  const unlockOnce = () => {
    unlockAudio();
  };
  document.addEventListener('pointerdown', unlockOnce, { once: true });

  const muteBtn = $('btn-mute');
  if (muteBtn) {
    bindTap(muteBtn, () => {
      setMuted(!isMuted());
      syncMuteButton();
      if (!isMuted()) sfx('tap');
    });
  }

  loadPeerJS().then((ok) => {
    const note = $('peer-note');
    if (note) {
      note.textContent = ok
        ? 'オンライン対戦: PeerJS準備OK（HTTPS推奨・6桁コード）'
        : 'PeerJS未読込 — ローカル練習は利用可能';
    }
  });
}

function syncMuteButton() {
  const muteBtn = $('btn-mute');
  if (!muteBtn) return;
  muteBtn.textContent = isMuted() ? '🔇 音オフ' : '🔊 音オン';
  muteBtn.setAttribute('aria-pressed', isMuted() ? 'true' : 'false');
}
