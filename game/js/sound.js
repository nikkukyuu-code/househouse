/**
 * ハウスと罠 — procedural SFX via Web Audio (no external files)
 */

let ctx = null;
let master = null;
let muted = false;
let unlocked = false;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** Call from a user gesture so mobile browsers allow audio */
export async function unlockAudio() {
  const c = ensure();
  if (!c) return false;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch (_) {}
  }
  unlocked = c.state === 'running';
  return unlocked;
}

export function isMuted() { return muted; }

export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('ht_mute', muted ? '1' : '0'); } catch (_) {}
  if (master) master.gain.value = muted ? 0 : 0.35;
}

export function loadMutePref() {
  try {
    if (localStorage.getItem('ht_mute') === '1') setMuted(true);
  } catch (_) {}
}

function beep(opts) {
  const c = ensure();
  if (!c || muted || !master) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const {
    type = 'square',
    freq = 440,
    freqEnd = freq,
    dur = 0.12,
    gain = 0.2,
    delay = 0,
    attack = 0.01,
    decay = 0.08,
  } = opts;

  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.02, dur - decay));
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(dur = 0.15, gain = 0.15, delay = 0) {
  const c = ensure();
  if (!c || muted || !master) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** Named cues used by the game */
export const SFX = {
  tap() {
    beep({ type: 'square', freq: 660, freqEnd: 520, dur: 0.06, gain: 0.08 });
  },
  place() {
    beep({ type: 'triangle', freq: 520, freqEnd: 780, dur: 0.1, gain: 0.14 });
  },
  ready() {
    beep({ type: 'sine', freq: 392, dur: 0.1, gain: 0.12 });
    beep({ type: 'sine', freq: 523, dur: 0.12, gain: 0.12, delay: 0.1 });
  },
  step() {
    beep({ type: 'triangle', freq: 180, freqEnd: 120, dur: 0.04, gain: 0.05 });
  },
  stairs() {
    beep({ type: 'square', freq: 300, dur: 0.06, gain: 0.1 });
    beep({ type: 'square', freq: 400, dur: 0.08, gain: 0.1, delay: 0.07 });
  },
  trap() {
    noiseBurst(0.12, 0.18);
    beep({ type: 'sawtooth', freq: 220, freqEnd: 80, dur: 0.2, gain: 0.16 });
  },
  pit() {
    noiseBurst(0.18, 0.14);
    beep({ type: 'sine', freq: 160, freqEnd: 55, dur: 0.35, gain: 0.2 });
    beep({ type: 'triangle', freq: 90, freqEnd: 40, dur: 0.4, gain: 0.12, delay: 0.05 });
  },
  chest() {
    beep({ type: 'sine', freq: 523, dur: 0.12, gain: 0.14 });
    beep({ type: 'sine', freq: 659, dur: 0.12, gain: 0.14, delay: 0.1 });
    beep({ type: 'sine', freq: 784, dur: 0.18, gain: 0.16, delay: 0.2 });
    beep({ type: 'triangle', freq: 1046, dur: 0.25, gain: 0.1, delay: 0.32 });
  },
  hurt() {
    beep({ type: 'sawtooth', freq: 320, freqEnd: 140, dur: 0.18, gain: 0.14 });
  },
  win() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      beep({ type: 'sine', freq: f, dur: 0.2, gain: 0.14, delay: i * 0.12 });
    });
  },
  lose() {
    beep({ type: 'triangle', freq: 392, freqEnd: 196, dur: 0.35, gain: 0.14 });
    beep({ type: 'sine', freq: 247, freqEnd: 123, dur: 0.45, gain: 0.12, delay: 0.15 });
  },
  slowMo() {
    beep({ type: 'sine', freq: 200, freqEnd: 100, dur: 0.5, gain: 0.1 });
  },
  alarm() {
    beep({ type: 'square', freq: 920, dur: 0.09, gain: 0.11 });
    beep({ type: 'square', freq: 690, dur: 0.09, gain: 0.1, delay: 0.1 });
    beep({ type: 'square', freq: 920, dur: 0.12, gain: 0.12, delay: 0.2 });
  },
};

export function play(name) {
  const fn = SFX[name];
  if (fn) fn();
}
