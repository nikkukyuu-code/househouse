/**
 * ハウスの罠（仮） — PeerJS networking (optional; graceful fallback)
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

  async host() {
    const ok = await loadPeerJS();
    if (!ok) throw new Error('PeerJSを読み込めませんでした');
    PeerCtor = window.Peer;
    this.roomCode = genRoomCode();
    this.role = 'host';
    const id = 'HH-' + this.roomCode;
    this._status('ルーム作成中…');
    await new Promise((resolve, reject) => {
      this.peer = new PeerCtor(id, { debug: 0 });
      this.peer.on('open', () => {
        this._status('コード: ' + this.roomCode + ' — 相手を待っています');
        resolve();
      });
      this.peer.on('error', (e) => reject(e));
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
    });
    conn.on('close', () => {
      this._status('相手が切断しました');
      if (this.onPeerLost) this.onPeerLost();
    });
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
