/**
 * ハウスハウス — Core game loop (mobile-first)
 */

import {
  TILE, FLOORS, COLS, ROWS, T, MAX_TRAPS, MAX_HP,
  TRAP_NORMAL, TRAP_PIT, normalizeTrap,
  createBlueprint, createEmptyHouseData, isWalkable, isPlaceable,
  validateHouse, getSpawn, tileAt, drawHouse, drawPlayer, drawTrapSprite, drawChestSprite,
  floorLabel, COLORS, generateComHouse, parseHouse,
} from './house.js';
import { NetSession, loadPeerJS, isPeerAvailable, isValidRoomCode, normalizeRoomCode } from './net.js';
import { $, showScreen, setStatus, heartsHtml, bindHold, bindTap, lockTouch, flashOverlay } from './ui.js';

const blueprint = createBlueprint();

/** App state */
const S = {
  mode: null, // 'online-host' | 'online-guest' | 'local' | 'com'
  net: null,
  phase: 'title',
  myHouse: createEmptyHouseData(),
  theirHouse: createEmptyHouseData(),
  setupTool: 'chest', // 'chest' | 'trap-normal' | 'trap-pit' | 'erase'
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
  return tool === 'trap' || tool === 'trap-normal' || tool === 'trap-pit';
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
    ex.floor += 1;
    const down = findStairs(ex.floor, T.STAIRS_DOWN);
    if (down) { ex.x = down.x; ex.y = down.y; }
  } else if (t === T.STAIRS_DOWN && ex.floor > 0) {
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

/* ---------- COM / AI explorer ---------- */
function aiStep(ex) {
  if (!ex.visited) ex.visited = new Set();
  if (!ex.memory) ex.memory = { preferFloor: 0, stuck: 0, phase: 0 };
  ex.memory.phase = (ex.memory.phase || 0) + 1;
  const key = `${ex.floor},${ex.x},${ex.y}`;
  ex.visited.add(key);

  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function canStep(dx, dy) {
    const nx = ex.x + dx, ny = ex.y + dy;
    return isWalkable(tileAt(blueprint, ex.floor, nx, ny));
  }

  function scoreDir(dx, dy) {
    const nx = ex.x + dx, ny = ex.y + dy;
    if (!canStep(dx, dy)) return -999;
    const nk = `${ex.floor},${nx},${ny}`;
    let s = 0;
    const t = tileAt(blueprint, ex.floor, nx, ny);
    if (!ex.visited.has(nk)) s += 8;
    else s -= 3;
    const targetFloor = Math.min(FLOORS - 1, (ex.memory.phase / 55) | 0);
    if (t === T.STAIRS_UP && ex.floor < targetFloor) s += 6;
    if (t === T.STAIRS_UP && ex.floor >= targetFloor && Math.random() < 0.25) s += 3;
    if (t === T.STAIRS_DOWN && ex.floor > targetFloor) s += 5;
    if (t === T.DOOR) s += 2;
    s += Math.random() * 4;
    if (ex.memory.lastDx === -dx && ex.memory.lastDy === -dy) s -= 2;
    return s;
  }

  if (Math.random() < 0.12) {
    const shuffled = dirs.slice().sort(() => Math.random() - 0.5);
    for (const [dx, dy] of shuffled) {
      if (tryMove(ex, dx, dy)) {
        ex.memory.lastDx = dx;
        ex.memory.lastDy = dy;
        ex.memory.stuck = 0;
        return true;
      }
    }
  }

  let best = null, bestS = -999;
  for (const [dx, dy] of dirs) {
    const s = scoreDir(dx, dy);
    if (s > bestS) { bestS = s; best = [dx, dy]; }
  }
  if (best && bestS > -999) {
    if (tryMove(ex, best[0], best[1])) {
      ex.memory.lastDx = best[0];
      ex.memory.lastDy = best[1];
      ex.memory.stuck = 0;
      return true;
    }
  }
  ex.memory.stuck = (ex.memory.stuck || 0) + 1;
  for (const [dx, dy] of dirs.sort(() => Math.random() - 0.5)) {
    if (tryMove(ex, dx, dy)) return true;
  }
  return false;
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
  } else if (isTrapTool(S.setupTool)) {
    if (house.traps.length >= MAX_TRAPS) {
      setStatus($('setup-status'), `罠は最大${MAX_TRAPS}個まで`, 'warn');
      return;
    }
    const kind = S.setupTool === 'trap-pit' ? TRAP_PIT : TRAP_NORMAL;
    house.traps.push({ floor, x, y, kind });
    setStatus(
      $('setup-status'),
      kind === TRAP_PIT ? '落とし穴を配置しました' : '通常罠を配置しました',
      'ok'
    );
  } else {
    setStatus($('setup-status'), '上のボタンで宝箱か罠を選んでから床をタップ', 'warn');
    return;
  }
  updateSetupHud();
  drawSetup();
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
  const cs = cellSizeFor(canvas);
  const ox = Math.floor((w - COLS * cs) / 2);
  const oy = Math.floor((h - ROWS * cs) / 2) + 6;

  // Base tiles only — never leak secrets via drawHouse items
  drawHouse(ctx, blueprint, null, explorer.floor, {
    showChest: false,
    showTraps: false,
    ox, oy, cellSize: cs,
  });

  if (houseShown) {
    if (showSecrets) {
      // Designer watching: all traps + chest
      drawHouseItems(ctx, houseShown, explorer.floor, triggered, true, true, ox, oy, cs);
    } else {
      // Explorer: only triggered traps; chest only if already found or match ended reveal
      const showChest = !!(explorer.foundChest || S.revealSecrets);
      drawHouseItems(ctx, houseShown, explorer.floor, triggered, false, showChest, ox, oy, cs);
    }
  }

  const color = isOpponentView ? COLORS.player2 : COLORS.player1;
  drawPlayer(ctx, explorer.x, explorer.y, color, ox, oy, cs, S.time * 0.008);

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
  ctx.fillText(floorLabel(explorer.floor), w - 8, 15);

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
}

function drawHouseItems(ctx, houseData, floor, triggered, showAllTraps, showChest, ox, oy, cs) {
  for (const raw of houseData.traps) {
    const tr = normalizeTrap(raw);
    if (!tr || tr.floor !== floor) continue;
    const key = `${tr.floor},${tr.x},${tr.y}`;
    const isTrig = triggered.has(key);
    if (!showAllTraps && !isTrig) continue;
    drawTrapSprite(ctx, tr, isTrig, ox + tr.x * cs, oy + tr.y * cs, cs);
  }
  if (showChest && houseData.chest && houseData.chest.floor === floor) {
    const c = houseData.chest;
    drawChestSprite(ctx, ox + c.x * cs, oy + c.y * cs, cs);
  }
}

function addFx(view, text, color) {
  S.fx.push({ view, text, color, age: 0, life: 1000 });
}

function updateHpBars() {
  $('hp-top').innerHTML = heartsHtml(S.foeHp, MAX_HP);
  $('hp-bot').innerHTML = heartsHtml(S.myHp, MAX_HP);
}

function endGame(winner) {
  if (S.ended) return;
  S.ended = true;
  S.winner = winner;
  S.revealSecrets = true;
  const overlay = $('result-overlay');
  const title = $('result-title');
  const sub = $('result-sub');
  overlay.classList.add('show');
  if (winner === 'me') {
    title.textContent = '勝利！';
    title.className = 'win';
    sub.textContent = '宝箱を見つけたか、相手の体力をゼロにしました';
  } else {
    title.textContent = '敗北…';
    title.className = 'lose';
    sub.textContent = '相手に宝箱を取られたか、体力が尽きました';
  }
  if (S.mode && S.mode.startsWith('online') && S.net) {
    S.net.send({ type: 'gameover', winner: winner === 'me' ? 'host_or_self' : 'other', from: S.mode });
  }
}

/* ---------- Match loop ---------- */
function onTrapHit(who, tr) {
  const kind = tr.kind === TRAP_PIT ? TRAP_PIT : TRAP_NORMAL;
  const isPit = kind === TRAP_PIT;

  if (who === 'me') {
    S.myHp = Math.max(0, S.myHp - 1);
    if (isPit) {
      applyPitfallDrop(S.me);
      addFx('bot', '落とし穴！', '#aa66ff');
      flashOverlay($('flash-bot'), '🕳 落とし穴！', 700);
    } else {
      addFx('bot', '罠だ！', '#ff4444');
      flashOverlay($('flash-bot'), '💥 罠！', 600);
    }
    if (S.myHp <= 0) endGame('foe');
  } else {
    S.foeHp = Math.max(0, S.foeHp - 1);
    if (isPit && S.foe) {
      applyPitfallDrop(S.foe);
      addFx('top', '落とし穴作動！', '#aa66ff');
      flashOverlay($('flash-top'), '🕳 落とし穴！', 700);
    } else {
      addFx('top', '罠作動！', '#ffaa00');
      flashOverlay($('flash-top'), '💥 罠作動！', 600);
    }
    if (S.foeHp <= 0) endGame('me');
  }
  updateHpBars();
  if (S.mode && S.mode.startsWith('online') && S.net) {
    const ex = who === 'me' ? S.me : S.foe;
    S.net.send({
      type: 'trap',
      who,
      floor: tr.floor,
      x: tr.x,
      y: tr.y,
      kind,
      myHp: S.myHp,
      foeHp: S.foeHp,
      // After pitfall, report new position of the victim
      newFloor: ex ? ex.floor : undefined,
      newX: ex ? ex.x : undefined,
      newY: ex ? ex.y : undefined,
    });
  }
}

function onChestFound(who) {
  if (who === 'me') {
    addFx('bot', '宝箱ゲット！', '#ffd700');
    flashOverlay($('flash-bot'), '💎 宝箱！', 800);
    endGame('me');
  } else {
    addFx('top', '相手が宝箱を発見！', '#ffd700');
    flashOverlay($('flash-top'), '💎 発見！', 800);
    endGame('foe');
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
  const dt = Math.min(50, ts - (lastTs || ts));
  lastTs = ts;
  S.time += dt;

  if (S.phase !== 'match') return;

  S.moveCooldown = Math.max(0, S.moveCooldown - dt);
  applyMoveFromInput();

  if ((S.mode === 'local' || S.mode === 'com') && S.foe && !S.ended) {
    aiTimer += dt;
    if (aiTimer > (S.mode === 'com' ? 420 : 380)) {
      aiTimer = 0;
      aiStep(S.foe);
      checkHazards(S.foe, S.foeTriggered, (tr) => onTrapHit('foe', tr), () => onChestFound('foe'));
    }
  }

  for (const f of S.fx) f.age += dt;
  S.fx = S.fx.filter((f) => f.age < f.life);

  if (ctxTop && S.foe) {
    // Top: opponent exploring YOUR house — you see your secrets
    redrawMatchView(ctxTop, canvTop, S.foe, S.myHouse, true, S.foeTriggered, true);
  }
  if (ctxBot && S.me) {
    // Bottom: you exploring THEIR house — hide secrets except triggered
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
        S.foeHp = typeof msg.myHp === 'number' ? msg.myHp : Math.max(0, S.foeHp - 1);
        if (msg.kind === TRAP_PIT) {
          addFx('top', '落とし穴作動！', '#aa66ff');
          if (S.foe && typeof msg.newFloor === 'number') {
            S.foe.floor = msg.newFloor;
            S.foe.x = msg.newX;
            S.foe.y = msg.newY;
          }
        } else {
          addFx('top', '罠作動！', '#ffaa00');
        }
        updateHpBars();
        if (S.foeHp <= 0) endGame('me');
      }
      break;
    case 'chest':
      if (msg.who === 'me') {
        endGame('foe');
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
  showScreen('screen-setup');
  updateSetupHud();
  requestAnimationFrame(() => {
    drawSetup();
  });
  setStatus($('setup-status'), 'マスをタップして配置。宝箱1つ必須。罠は通常／落とし穴。', '');
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
  $('result-overlay').classList.remove('show');
  $('btn-ready').disabled = false;

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

  bindTap($('btn-create'), () => createRoom());
  bindTap($('btn-join'), () => showJoinLobby());
  bindTap($('btn-com'), () => {
    S.mode = 'com';
    startSetup();
  });
  bindTap($('btn-local'), () => {
    S.mode = 'local';
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

  loadPeerJS().then((ok) => {
    const note = $('peer-note');
    if (note) {
      note.textContent = ok
        ? 'オンライン対戦: PeerJS準備OK（HTTPS推奨・6桁コード）'
        : 'PeerJS未読込 — ローカル練習は利用可能';
    }
  });
}
