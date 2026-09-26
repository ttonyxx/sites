"use client";
/**
 * Tiny synthesized sound kit (WebAudio, no files). Quiet by design: clacks
 * for tiles, a rising chime for steals that climbs with the combo.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled || typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: master! };
}

interface ToneOpts {
  freq: number;
  to?: number;
  type?: OscillatorType;
  at?: number;
  attack?: number;
  decay?: number;
  gain?: number;
}

function tone({ freq, to, type = "sine", at = 0, attack = 0.004, decay = 0.14, gain = 0.07 }: ToneOpts) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + at;
  const osc = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + attack + decay);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(g).connect(a.out);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.02);
}

function clack(at = 0, pitch = 1, gain = 0.09) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + at;
  const len = Math.floor(a.ctx.sampleRate * 0.03);
  const buf = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const bp = a.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200 * pitch;
  bp.Q.value = 1.4;
  const g = a.ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.out);
  src.start(t0);
  tone({ freq: 190 * pitch, type: "sine", at, attack: 0.002, decay: 0.05, gain: gain * 0.5 });
}

const semis = (n: number) => 2 ** (n / 12);

export const sfx = {
  /** Picking up / putting down a tile. */
  select: () => clack(0, 1.15, 0.07),
  deselect: () => clack(0, 0.9, 0.05),
  /** A new pool letter flips over. */
  flip: () => {
    clack(0, 1.4, 0.05);
    tone({ freq: 1320, type: "triangle", at: 0.01, decay: 0.06, gain: 0.02 });
  },
  /** Successful steal; pitch climbs with the combo. */
  steal: (combo = 1, sources = 1) => {
    const base = 523.25 * semis(Math.min(combo - 1, 10) * 2);
    tone({ freq: base, type: "triangle", decay: 0.16, gain: 0.07 });
    tone({ freq: base * semis(7), type: "triangle", at: 0.06, decay: 0.2, gain: 0.06 });
    if (sources >= 2) tone({ freq: base * 2, type: "sine", at: 0.12, decay: 0.3, gain: 0.04 });
    for (let i = 0; i < 4; i++) clack(0.02 + i * 0.025, 1 + i * 0.08, 0.05);
  },
  wrong: () => {
    tone({ freq: 150, to: 105, type: "square", decay: 0.16, gain: 0.035 });
    tone({ freq: 155, to: 110, type: "sawtooth", decay: 0.14, gain: 0.02 });
  },
  soft: () => tone({ freq: 440, type: "sine", decay: 0.08, gain: 0.03 }),
  rival: () => {
    tone({ freq: 392, type: "triangle", decay: 0.12, gain: 0.05 });
    tone({ freq: 311, type: "triangle", at: 0.1, decay: 0.2, gain: 0.05 });
  },
  tick: () => tone({ freq: 980, type: "sine", decay: 0.05, gain: 0.03 }),
  countdown: (final = false) => tone({ freq: final ? 880 : 587, type: "triangle", decay: final ? 0.3 : 0.12, gain: 0.06 }),
  end: () => {
    [0, 4, 7, 12].forEach((n, i) => tone({ freq: 392 * semis(n), type: "triangle", at: i * 0.07, decay: 0.4, gain: 0.05 }));
  },
  achievement: () => {
    [0, 7, 12, 16, 19].forEach((n, i) => tone({ freq: 659 * semis(n), type: "sine", at: i * 0.06, decay: 0.35, gain: 0.04 }));
  },
};
