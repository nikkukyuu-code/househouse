/**
 * ハウスハウス — Core game loop (mobile-first)
 */

import {
  TILE, FLOORS, COLS, ROWS, T, MAX_TRAPS, MAX_HP,
  createBlueprint, createEmptyHouseData, isWalkable, isPlaceable,
  validateHouse, getSpawn, tileAt, drawHouse, drawPlayer, floorLabel, COLORS,
  generateComHouse,
} from './house.js';
import { NetSession, loadPeerJS, isPeerAvailable } from './net.js';
import { $, showScreen, setStatus, heartsHtml, bindHold, bindTap, lockTouch, flashOverlay } from './ui.js';

const blueprint = createBlueprint();

/** App state */
const S = {
  mode: null, // 'online-host' | 'online-guest' | 'local'
  net: null,
  phase: 'title',
  // houses
  myHouse: createEmptyHouseData(),
  theirHouse: createEmptyHouseData(),
  setupTool: 'chest', // 'chest' | 'trap' | 'erase'
  setupFloor: 0,
  setupWhich: 'mine', // 'mine' | 'theirs' (local sequential)
  localStep: 0, // 0=design mine, 1=design theirs
  // match
  me: null,
  foe: null, // for local: AI explorer in my house
  myHp: MAX_HP,
  foeHp: MAX_HP,
  myTriggered: new Set(),
  foeTriggered: new Set(),
  ended: false,
  winner: null, // 'me' | 'foe' | null
  // input
  holdDir: null, // 'u'|'d'|'l'|'r'
  moveCooldown: 0,
  // fx
  fx: [],
  time: 0,
  readyMine: false,
  readyTheirs: false,
  peerReady: false,
  iAmReady: false,
};

let canvTop, canvBot, ctxTop, ctxBot;
let animId = 0;
let lastTs = 0;

function cellSizeFor(canvas) {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  return Math.floor(Math.min(w / COLS, h / ROWS));
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

/* ---------- Player entity ---------- */
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
  // stairs
  if (t === T.STAIRS_UP && ex.floor < FLOORS - 1) {
    ex.floor += 1;
    // land on stairs down of upper floor if exists, else same xy
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

function checkHazards(ex, triggeredSet, onTrap, onChest) {
  const h = ex.house;
  if (!h) return;
  // traps
  for (const tr of h.traps) {
    if (tr.floor === ex.floor && tr.x === ex.x && tr.y === ex.y) {
      const key = `${tr.floor},${tr.x},${tr.y}`;
      if (!triggeredSet.has(key)) {
        triggeredSet.add(key);
        ex.triggered.add(key);
        onTrap(tr, key);
      }
    }
  }
  // chest
  if (h.chest && h.chest.floor === ex.floor && h.chest.x === ex.x && h.chest.y === ex.y) {
    if (!ex.foundChest) {
      ex.foundChest = true;
      onChest();
    }
  }
}

/* ---------- COM / AI explorer (imperfect — no chest omniscience) ---------- */
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
    // Prefer unvisited
    if (!ex.visited.has(nk)) s += 8;
    else s -= 3;
    // Soft floor progression: explore current floor then go up
    const targetFloor = Math.min(FLOORS - 1, (ex.memory.phase / 55) | 0);
    if (t === T.STAIRS_UP && ex.floor < targetFloor) s += 6;
    if (t === T.STAIRS_UP && ex.floor >= targetFloor && Math.random() < 0.25) s += 3;
    if (t === T.STAIRS_DOWN && ex.floor > targetFloor) s += 5;
    // Doorways lead to new rooms
    if (t === T.DOOR) s += 2;
    // Light randomness (imperfect)
    s += Math.random() * 4;
    // Avoid immediate reverse thrashing
    if (ex.memory.lastDx === -dx && ex.memory.lastDy === -dy) s -= 2;
    return s;
  }

  // Occasionally random move (dumb moment — may hit traps)
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
  // Unstick: take any walkable including stairs
  for (const [dx, dy] of dirs.sort(() => Math.random() - 0.5)) {
    if (tryMove(ex, dx, dy)) return true;
  }
  return false;
}

/* ---------- Setup placement ---------- */
function placeAt(floor, x, y) {
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  if (!isPlaceable(blueprint, floor, x, y)) return;

  if (S.setupTool === 'erase') {
    if (house.chest && house.chest.floor === floor && house.chest.x === x && house.chest.y === y) {
      house.chest = null;
    }
    house.traps = house.traps.filter((t) => !(t.floor === floor && t.x === x && t.y === y));
    updateSetupHud();
    drawSetup();
    return;
  }

  // occupied?
  const occChest = house.chest && house.chest.floor === floor && house.chest.x === x && house.chest.y === y;
  const occTrap = house.traps.some((t) => t.floor === floor && t.x === x && t.y === y);
  if (occChest || occTrap) return;

  if (S.setupTool === 'chest') {
    house.chest = { floor, x, y };
  } else if (S.setupTool === 'trap') {
    if (house.traps.length >= MAX_TRAPS) {
      setStatus($('setup-status'), `罠は最大${MAX_TRAPS}個まで`, 'warn');
      return;
    }
    house.traps.push({ floor, x, y });
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
  // floor tabs
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
  const cs = cellSizeFor(c);
  const ox = Math.floor(((c.clientWidth || c.width) - COLS * cs) / 2);
  const oy = Math.floor(((c.clientHeight || c.height) - ROWS * cs) / 2);
  const house = S.setupWhich === 'mine' ? S.myHouse : S.theirHouse;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
  drawHouse(ctx, blueprint, house, S.setupFloor, {
    showChest: true,
    showTraps: true,
    triggeredTraps: new Set(),
    ox, oy, cellSize: cs,
  });
  // highlight placeable lightly
  c._map = { ox, oy, cs };
}

function setupCanvasTap(e) {
  const c = $('setup-canvas');
  if (!c || !c._map) return;
  const rect = c.getBoundingClientRect();
  const t = e.changedTouches ? e.changedTouches[0] : e;
  const mx = t.clientX - rect.left;
  const my = t.clientY - rect.top;
  const { ox, oy, cs } = c._map;
  const x = Math.floor((mx - ox) / cs);
  const y = Math.floor((my - oy) / cs);
  if (x >= 0 && y >= 0 && x < COLS && y < ROWS) {
    placeAt(S.setupFloor, x, y);
  }
}

/* ---------- Match rendering ---------- */
function drawMatchView(ctx, canvas, explorer, houseShown, showSecrets, triggered, title, hp, isOpponentView) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = isOpponentView ? '#1a1020' : '#101820';
  ctx.fillRect(0, 0, w, h);
  const cs = cellSizeFor(canvas);
  const ox = Math.floor((w - COLS * cs) / 2);
  const oy = Math.floor((h - ROWS * cs) / 2) + 4;
  drawHouse(ctx, blueprint, houseShown, explorer.floor, {
    showChest: showSecrets,
    showTraps: showSecrets || triggered.size > 0,
    // In opponent view (top): you see YOUR traps/chest always
    // In your view (bottom): you don't see opponent traps until triggered — but we show triggered
    // Actually: designer sees own house secrets on top; explorer shouldn't see traps on bottom until hit
    // For bottom: showTraps only for triggered ones — drawHouse shows all if showTraps. Patch:
    triggeredTraps: triggered,
    ox, oy, cellSize: cs,
  });
  // Re-draw traps selectively for explorer view
  if (!showSecrets && houseShown) {
    // clear and redraw without untriggered traps — already drew with showTraps maybe wrong
    // Simpler: redraw floors then only triggered traps + no chest
  }

  // Player
  const color = isOpponentView ? COLORS.player2 : COLORS.player1;
  drawPlayer(ctx, explorer.x, explorer.y, color, ox, oy, cs, S.time * 0.008);

  // HUD strip
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, 28);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, 8, 14);
  ctx.textAlign = 'right';
  ctx.fillText(floorLabel(explorer.floor), w - 8, 14);

  // FX
  for (const f of S.fx) {
    if (f.view !== (isOpponentView ? 'top' : 'bot')) continue;
    const alpha = Math.max(0, 1 - f.age / f.life);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.font = `bold ${16 + f.age * 0.05}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(f.text, w / 2, h * 0.35 - f.age * 0.04);
    ctx.globalAlpha = 1;
  }
}

function redrawMatchSecretsFix(ctx, canvas, explorer, houseShown, showSecrets, triggered, isOpponentView) {
  // Redraw properly: showSecrets true on top (your house), false on bottom except triggered traps
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = isOpponentView ? '#1a1020' : '#101820';
  ctx.fillRect(0, 0, w, h);
  const cs = cellSizeFor(canvas);
  const ox = Math.floor((w - COLS * cs) / 2);
  const oy = Math.floor((h - ROWS * cs) / 2) + 6;

  // Draw house base without items
  drawHouse(ctx, blueprint, null, explorer.floor, { showChest: false, showTraps: false, ox, oy, cellSize: cs });

  if (houseShown) {
    if (showSecrets) {
      // all traps + chest
      drawHouseItems(ctx, houseShown, explorer.floor, triggered, true, true, ox, oy, cs);
    } else {
      // only triggered traps, no chest
      drawHouseItems(ctx, houseShown, explorer.floor, triggered, false, false, ox, oy, cs);
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
  if (showAllTraps || triggered.size) {
    for (const tr of houseData.traps) {
      if (tr.floor !== floor) continue;
      const key = `${tr.floor},${tr.x},${tr.y}`;
      const isTrig = triggered.has(key);
      if (!showAllTraps && !isTrig) continue;
      const px = ox + tr.x * cs;
      const py = oy + tr.y * cs;
      ctx.fillStyle = isTrig ? '#555' : COLORS.trapArmed;
      ctx.beginPath();
      ctx.arc(px + cs / 2, py + cs / 2, cs * 0.28, 0, Math.PI * 2);
      ctx.fill();
      if (!isTrig) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.floor(cs * 0.4)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', px + cs / 2, py + cs / 2 + 1);
      }
    }
  }
  if (showChest && houseData.chest && houseData.chest.floor === floor) {
    const c = houseData.chest;
    const px = ox + c.x * cs;
    const py = oy + c.y * cs;
    ctx.fillStyle = COLORS.chest;
    ctx.fillRect(px + 6, py + 10, cs - 12, cs - 14);
    ctx.fillStyle = COLORS.chestLid;
    ctx.fillRect(px + 4, py + 6, cs - 8, 8);
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
  // who: 'me' (I stepped on their trap) or 'foe' (they stepped on my trap)
  if (who === 'me') {
    S.myHp = Math.max(0, S.myHp - 1);
    addFx('bot', '罠だ！', '#ff4444');
    flashOverlay($('flash-bot'), '💥 罠！', 600);
    if (S.myHp <= 0) endGame('foe');
  } else {
    S.foeHp = Math.max(0, S.foeHp - 1);
    addFx('top', '罠作動！', '#ffaa00');
    flashOverlay($('flash-top'), '💥 罠作動！', 600);
    if (S.foeHp <= 0) endGame('me');
  }
  updateHpBars();
  if (S.mode && S.mode.startsWith('online') && S.net) {
    S.net.send({ type: 'trap', who, floor: tr.floor, x: tr.x, y: tr.y, myHp: S.myHp, foeHp: S.foeHp });
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

  // AI for local
  if ((S.mode === 'local' || S.mode === 'com') && S.foe && !S.ended) {
    aiTimer += dt;
    if (aiTimer > (S.mode === 'com' ? 420 : 380)) {
      aiTimer = 0;
      aiStep(S.foe);
      checkHazards(S.foe, S.foeTriggered, (tr) => onTrapHit('foe', tr), () => onChestFound('foe'));
    }
  }

  // FX age
  for (const f of S.fx) f.age += dt;
  S.fx = S.fx.filter((f) => f.age < f.life);

  // Draw
  if (ctxTop && S.foe) {
    // Top: opponent exploring YOUR house — you see secrets
    redrawMatchSecretsFix(ctxTop, canvTop, S.foe, S.myHouse, true, S.foeTriggered, true);
  }
  if (ctxBot && S.me) {
    // Bottom: you exploring THEIR house — hide secrets except triggered
    redrawMatchSecretsFix(ctxBot, canvBot, S.me, S.theirHouse, false, S.myTriggered, false);
  }
}

/* ---------- Networking handlers ---------- */
function handleNetMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'house':
      S.theirHouse = msg.house;
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
      // Peer reports they hit a trap in our house or we need sync
      if (msg.who === 'me') {
        // peer hit a trap in our house → foe took damage from our perspective... 
        // Peer sends who='me' meaning THEY got hit. So foeHp decreases for us.
        const key = `${msg.floor},${msg.x},${msg.y}`;
        S.foeTriggered.add(key);
        S.foeHp = typeof msg.myHp === 'number' ? msg.myHp : Math.max(0, S.foeHp - 1);
        addFx('top', '罠作動！', '#ffaa00');
        updateHpBars();
        if (S.foeHp <= 0) endGame('me');
      }
      break;
    case 'chest':
      if (msg.who === 'me') {
        // peer found chest in our house
        endGame('foe');
      }
      break;
    case 'gameover':
      // peer ended — if they won, we lost
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
  showScreen('screen-setup');
  updateSetupHud();
  requestAnimationFrame(() => {
    drawSetup();
  });
  setStatus($('setup-status'), 'マスをタップして配置。宝箱1つ必須。', '');
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

  // online
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
  S.myHp = MAX_HP;
  S.foeHp = MAX_HP;
  S.myTriggered = new Set();
  S.foeTriggered = new Set();
  S.fx = [];
  S.holdDir = null;
  S.moveCooldown = 0;
  aiTimer = 0;

  // me explores their house; foe explores my house
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
  $('room-code-display').textContent = '----';
  try {
    S.net = new NetSession();
    S.net.onStatus = (m) => setStatus($('net-status'), m, '');
    S.net.onMessage = handleNetMessage;
    S.net.onPeerLost = () => setStatus($('net-status'), '相手が切断しました', 'warn');
    S.mode = 'online-host';
    const code = await S.net.host();
    $('room-code-display').textContent = code;
    setStatus($('net-status'), 'このコードを相手に伝えてください', 'ok');
    // When peer connects, go to setup
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
  const code = ($('join-code-input').value || '').trim().toUpperCase();
  if (code.length < 4) {
    setStatus($('net-status'), '4文字のルームコードを入力', 'warn');
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
  setStatus($('net-status'), 'ホストのルームコードを入力', '');
  S.mode = 'online-guest';
}

/* ---------- Input binding ---------- */
function bindControls() {
  // D-pad
  document.querySelectorAll('.dpad-btn').forEach((btn) => {
    const dir = btn.dataset.dir;
    bindHold(
      btn,
      () => { S.holdDir = dir; },
      () => { if (S.holdDir === dir) S.holdDir = null; }
    );
  });

  // Floor change during match (optional quick stairs — actually stairs are on map; add floor hint buttons?)
  // Skip separate floor buttons — stairs on map.

  // Keyboard fallback
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

  // Title buttons
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

  // Setup
  document.querySelectorAll('.floor-tab').forEach((btn) => {
    bindTap(btn, () => {
      S.setupFloor = Number(btn.dataset.floor);
      updateSetupHud();
      drawSetup();
    });
  });
  document.querySelectorAll('.tool-btn').forEach((btn) => {
    bindTap(btn, () => {
      S.setupTool = btn.dataset.tool;
      updateSetupHud();
    });
  });
  bindTap($('btn-ready'), () => onReadySetup());
  bindTap($('btn-setup-back'), () => goTitle());

  const sc = $('setup-canvas');
  sc.addEventListener('click', setupCanvasTap);
  sc.addEventListener('touchend', (e) => {
    e.preventDefault();
    setupCanvasTap(e);
  }, { passive: false });

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
  // Prevent double-tap zoom
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

  // Preload PeerJS in background
  loadPeerJS().then((ok) => {
    const note = $('peer-note');
    if (note) {
      note.textContent = ok
        ? 'オンライン対戦: PeerJS準備OK（HTTPS推奨）'
        : 'PeerJS未読込 — ローカル練習は利用可能';
    }
  });
}
