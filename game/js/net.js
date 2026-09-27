/**
 * トリックハウスバトル — PeerJS networking (optional; graceful fallback)
 */

const PEER_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';

let PeerCtor = null;
let peerLoadPromise = null;

export function loadPeerJS() {
  if (typeof window !== 'undefined' && window.Peer) {
    PeerCtor = window.Peer;
    return Promise.resolve(true);
  }
  if (peerLoadPromise) return peerLoadPromise;
  peerLoadPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = PEER_CDN;
    s.async = true;
    s.onload = () => {
      PeerCtor = window.Peer || null;
      resolve(!!PeerCtor);
    };
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return peerLoadPromise;
}

export function isPeerAvailable() {
  return !!PeerCtor || !!(typeof window !== 'undefined' && window.Peer);
}

/** Exactly 6 digits (000000–999999, leading zeros OK) */
function genRoomCode() {
  const n = (Math.random() * 1000000) | 0;
  return String(n).padStart(6, '0');
}

export function normalizeRoomCode(code) {
  return String(code || '').trim().replace(/\D/g, '');
}

export function isValidRoomCode(code) {
  return /^\d{6}$/.test(normalizeRoomCode(code));
}

/**
 * Host: creates Peer with id HH-<code>, waits for guest connection.
 * Guest: connects to HH-<code>.
 * Protocol messages: { type, ... }
 */
export class NetSession {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.roomCode = null;
    this.onMessage = null;
    this.onStatus = null;
    this.onPeerLost = null;
  }

  _status(msg) {
    if (this.onStatus) this.onStatus(msg);
  }

  async host(fixedCode) {
    const ok = await loadPeerJS();
    if (!ok) throw new Error('PeerJSを読み込めませんでした');
    PeerCtor = window.Peer;
    this.roomCode = fixedCode && isValidRoomCode(fixedCode) ? normalizeRoomCode(fixedCode) : genRoomCode();
    this.role = 'host';
    const id = 'HH-' + this.roomCode;
    this._status('ルーム作成中…');
    await new Promise((resolve, reject) => {
      this.peer = new PeerCtor(id, { debug: 0 });
      this.peer.on('open', () => {
        this._status('コード: ' + this.roomCode + ' — 相手を待っています');
        resolve();
      });
      this.peer.on('error', (e) => {
        reject(e);
        if (this.onError) this.onError(e);
      });
      this.peer.on('connection', (conn) => {
        if (this.conn) {
          conn.close();
          return;
        }
        this._bindConn(conn);
      });
      this.peer.on('disconnected', () => this._status('切断されました'));
    });
    return this.roomCode;
  }

  async join(code) {
    const ok = await loadPeerJS();
    if (!ok) throw new Error('PeerJSを読み込めませんでした');
    PeerCtor = window.Peer;
    code = normalizeRoomCode(code);
    if (!/^\d{6}$/.test(code)) throw new Error('ルームコードは6桁の数字です');
    this.roomCode = code;
    this.role = 'guest';
    this._status('接続中…');
    await new Promise((resolve, reject) => {
      this.peer = new PeerCtor({ debug: 0 });
      this.peer.on('open', () => {
        const conn = this.peer.connect('HH-' + code, { reliable: true });
        conn.on('open', () => {
          this._bindConn(conn);
          this._status('接続しました');
          resolve();
        });
        conn.on('error', reject);
      });
      this.peer.on('error', reject);
    });
  }

  _bindConn(conn) {
    this.conn = conn;
    this._status(this.role === 'host' ? '相手が参加しました' : 'ホストに接続しました');
    conn.on('data', (data) => {
      if (this.onMessage) this.onMessage(data);
      else (this._queue || (this._queue = [])).push(data); // delivered by flushQueue()
    });
    conn.on('close', () => {
      this._status('相手が切断しました');
      if (this.onPeerLost) this.onPeerLost();
    });
  }

  flushQueue() {
    const q = this._queue || [];
    this._queue = [];
    if (this.onMessage) q.forEach((d) => this.onMessage(d));
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
      return true;
    }
    return false;
  }

  destroy() {
    try {
      if (this.conn) this.conn.close();
    } catch (_) {}
    try {
      if (this.peer) this.peer.destroy();
    } catch (_) {}
    this.conn = null;
    this.peer = null;
  }
}


/* ---------------------------------------------------------------------------
 * 対戦相手を探す (random matchmaking) — same approach as Space Trick Battle:
 * one well-known lobby peer id per game on the PeerJS cloud broker.
 *   1. Try to connect to the lobby id as a guest (short timeout).
 *   2. Nobody there → claim the lobby id and wait (countdown), like STB's host side.
 *   3. When a seeker connects, the lobby holder creates a normal numeric room
 *      (HH-<6 digits>), tells the seeker the code over the lobby link, then frees the
 *      lobby id. The pair then plays through the normal room host/join flow
 *      (host = lobby holder), so rules and the bc counter are unchanged.
 * Namespace: 'HH-quick-lobby-v1' → only トリックハウスバトル players match each other.
 * No automatic COM fallback (same as STB); the UI offers COM as a button on timeout.
 * ------------------------------------------------------------------------- */
const LOBBY_ID = 'HH-quick-lobby-v1';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const p = id ? new PeerCtor(id, { debug: 0 }) : new PeerCtor({ debug: 0 });
    const t = setTimeout(() => { try { p.destroy(); } catch (_) {} reject(new Error('接続サーバーに繋がりません')); }, 10000);
    p.on('open', () => { clearTimeout(t); resolve(p); });
    p.on('error', (e) => { clearTimeout(t); try { p.destroy(); } catch (_) {} reject(e); });
  });
}

export class QuickMatch {
  constructor({ onStatus, waitMs = 30000 } = {}) {
    this.onStatus = onStatus || (() => {});
    this.waitMs = waitMs;
    this.cancelled = false;
    this.peers = [];
    this.session = null;
  }

  cancel() {
    this.cancelled = true;
    for (const p of this.peers) { try { p.destroy(); } catch (_) {} }
    this.peers = [];
    if (this.session) { try { this.session.destroy(); } catch (_) {} }
    this.session = null;
  }

  _track(p) { this.peers.push(p); return p; }
  _drop(p) { try { p.destroy(); } catch (_) {} this.peers = this.peers.filter((x) => x !== p); }

  /** Resolves { role:'host'|'guest', session } (connected NetSession) or { role:null } on timeout. */
  async run() {
    const ok = await loadPeerJS();
    if (!ok) throw new Error('通信ライブラリを読み込めませんでした');
    PeerCtor = window.Peer;
    const deadline = Date.now() + this.waitMs;
    while (!this.cancelled && Date.now() < deadline) {
      this.onStatus({ phase: 'seek', msg: '対戦相手を探しています…', left: deadline - Date.now() });
      const code = await this._trySeek();
      if (this.cancelled) break;
      if (code) {
        this.onStatus({ phase: 'found', msg: '対戦相手が見つかりました！接続中…' });
        const s = await this._joinWithRetry(code);
        if (s) return { role: 'guest', session: s };
        continue; // host vanished → keep searching
      }
      const res = await this._holdLobby(deadline);
      if (this.cancelled) break;
      if (res === 'taken') { await sleep(300 + Math.random() * 500); continue; }
      if (res && res.session) return { role: 'host', session: res.session };
    }
    this.cancel();
    return { role: null };
  }

  /** Connect to the lobby holder; returns a room code or null. */
  async _trySeek() {
    let p;
    try { p = this._track(await openPeer(null)); } catch (_) { return null; }
    try {
      const conn = p.connect(LOBBY_ID, { reliable: true });
      const code = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 4000);
        p.on('error', () => { clearTimeout(t); resolve(null); });
        conn.on('error', () => { clearTimeout(t); resolve(null); });
        conn.on('close', () => { clearTimeout(t); resolve(null); });
        conn.on('open', () => { try { conn.send({ type: 'mm-hello', v: 1 }); } catch (_) {} });
        conn.on('data', (d) => {
          if (d && d.type === 'mm-room' && isValidRoomCode(d.code)) { clearTimeout(t); resolve(normalizeRoomCode(d.code)); }
          else if (d && d.type === 'mm-busy') { clearTimeout(t); resolve(null); }
        });
      });
      return code;
    } finally {
      this._drop(p);
    }
  }

  async _joinWithRetry(code) {
    for (let i = 0; i < 4 && !this.cancelled; i++) {
      const s = new NetSession();
      this.session = s;
      try {
        await Promise.race([s.join(code), sleep(7000).then(() => { throw new Error('timeout'); })]);
        if (this.cancelled) { s.destroy(); return null; }
        this.session = null;
        return s;
      } catch (_) {
        s.destroy();
        this.session = null;
        await sleep(700);
      }
    }
    return null;
  }

  /** Claim the lobby id and wait for a seeker until the deadline. */
  async _holdLobby(deadline) {
    let lobby;
    try { lobby = this._track(await openPeer(LOBBY_ID)); } catch (e) { return 'taken'; }
    this.onStatus({ phase: 'wait', msg: '対戦相手を待っています…', left: deadline - Date.now() });
    return await new Promise((resolve) => {
      let busy = false;
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearInterval(tick); this._drop(lobby); resolve(v); };
      const tick = setInterval(() => {
        if (this.cancelled) return finish(null);
        if (!busy && Date.now() >= deadline) return finish(null);
        if (!busy) this.onStatus({ phase: 'wait', msg: '対戦相手を待っています…', left: deadline - Date.now() });
      }, 250);
      lobby.on('disconnected', () => { if (!busy) finish('taken'); });
      lobby.on('connection', (conn) => {
        if (busy) {
          conn.on('open', () => { try { conn.send({ type: 'mm-busy' }); } catch (_) {} setTimeout(() => { try { conn.close(); } catch (_) {} }, 300); });
          return;
        }
        busy = true;
        conn.on('open', async () => {
          this.onStatus({ phase: 'found', msg: '対戦相手が見つかりました！部屋を準備中…' });
          let s = null;
          for (let i = 0; i < 3 && !this.cancelled && !s; i++) {
            const cand = new NetSession();
            this.session = cand;
            try { await cand.host(); s = cand; } catch (_) { cand.destroy(); this.session = null; }
          }
          if (!s || this.cancelled) { busy = false; try { conn.close(); } catch (_) {} return; }
          try { conn.send({ type: 'mm-room', code: s.roomCode }); } catch (_) {}
          // Free the lobby id shortly after the code is delivered.
          setTimeout(() => { if (!done) { done = true; clearInterval(tick); this._drop(lobby); } }, 800);
          const t0 = Date.now();
          while (!this.cancelled && Date.now() - t0 < 15000) {
            if (s.conn && s.conn.open) { this.session = null; return resolve({ session: s }); }
            await sleep(150);
          }
          s.destroy();
          this.session = null;
          resolve(null); // seeker never arrived → caller keeps searching if time remains
        });
        conn.on('error', () => { busy = false; });
      });
    });
  }
}
