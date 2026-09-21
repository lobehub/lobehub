import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Plugin } from 'vite';

const SAMPLE_RATE = 24_000;
const PEAK = 0.72;
const FADE_OUT = 0.012;
const ROOT = 698.5;

interface Partial {
  amp: number;
  decay: number;
  ratio: number;
}

interface Note {
  gain: number;
  ratio: number;
  start: number;
}

interface Instrument {
  attack?: number;
  body: Partial[];
  mallet?: { cutoff: number; decay: number; gain: number };
  shimmer?: {
    attack: number;
    delay: number;
    gain: number;
    mul: number;
    partials: Partial[];
    tail: number;
  };
  tail: number;
  transpose: number;
}

/** Rosewood marimba bar: the second partial is tuned to the 4th harmonic, not a whole ratio. */
const WOOD: Partial[] = [
  { amp: 1, decay: 9, ratio: 1 },
  { amp: 0.28, decay: 21.6, ratio: 3.99 },
];

/** Glass bell partials are deliberately inharmonic — whole ratios read as a synth, not a bell. */
const GLASS: Partial[] = [
  { amp: 1, decay: 3.2, ratio: 1 },
  { amp: 0.3, decay: 5.12, ratio: 2.01 },
  { amp: 0.12, decay: 8, ratio: 3.02 },
];

const MARIMBA: Instrument = {
  body: WOOD,
  mallet: { cutoff: 1800, decay: 260, gain: 0.14 },
  shimmer: { attack: 0.02, delay: 0.02, gain: 0.14, mul: 2, partials: GLASS, tail: 0.95 },
  tail: 0.7,
  transpose: 1,
};

const GLASS_BELL: Instrument = {
  attack: 0.005,
  body: [
    { amp: 1, decay: 2.8, ratio: 1 },
    { amp: 0.35, decay: 4.5, ratio: 2.01 },
    { amp: 0.15, decay: 7, ratio: 3.02 },
    { amp: 0.07, decay: 10, ratio: 4.2 },
  ],
  mallet: { cutoff: 4000, decay: 400, gain: 0.05 },
  tail: 1.4,
  transpose: 1.5,
};

const SOFT_TONE: Instrument = {
  attack: 0.012,
  body: [
    { amp: 1, decay: 5, ratio: 1 },
    { amp: 0.08, decay: 8, ratio: 2 },
  ],
  tail: 0.8,
  transpose: 1,
};

/** Hard-mallet xylophone bar, quint-tuned (1 : 3 : 6). */
const XYLOPHONE: Instrument = {
  body: [
    { amp: 1, decay: 16, ratio: 1 },
    { amp: 0.4, decay: 30, ratio: 3 },
    { amp: 0.15, decay: 45, ratio: 6.02 },
  ],
  mallet: { cutoff: 3500, decay: 300, gain: 0.22 },
  tail: 0.45,
  transpose: 1,
};

const RISE: Note[] = [
  { gain: 1, ratio: 1, start: 0 },
  { gain: 0.88, ratio: 1046.5 / 698.5, start: 0.09 },
];
const KNOCK: Note[] = [
  { gain: 1, ratio: 1, start: 0 },
  { gain: 0.8, ratio: 1, start: 0.13 },
];
const ARPEGGIO: Note[] = [
  { gain: 1, ratio: 1, start: 0 },
  { gain: 0.9, ratio: 1.26, start: 0.09 },
  { gain: 0.85, ratio: 1.498, start: 0.18 },
];
const DOORBELL: Note[] = [
  { gain: 1, ratio: 1.26, start: 0 },
  { gain: 0.9, ratio: 1, start: 0.28 },
];

const SOUNDS: Record<string, { duration: number; instrument: Instrument; notes: Note[] }> = {
  'chat-complete': { duration: 0.8, instrument: MARIMBA, notes: RISE },
  'glass-bell': { duration: 1.5, instrument: GLASS_BELL, notes: KNOCK },
  'soft-tone': { duration: 1, instrument: SOFT_TONE, notes: ARPEGGIO },
  'xylophone': { duration: 0.75, instrument: XYLOPHONE, notes: DOORBELL },
};

// UNNotificationSound resolves names only from ~/Library/Sounds, and only AIFF — a WAV
// there silently falls back to the system alert sound.
export const BANNER_SOUND = { aiff: 'lobehub-complete.aiff', source: 'chat-complete' };

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d_2b_79_f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4_294_967_296) * 2 - 1;
};

const addVoice = (
  buffer: Float64Array,
  {
    attack = 0.004,
    freq,
    gain,
    partials,
    start,
    tail,
  }: {
    attack?: number;
    freq: number;
    gain: number;
    partials: Partial[];
    start: number;
    tail: number;
  },
) => {
  const offset = Math.round(SAMPLE_RATE * start);
  const length = Math.min(buffer.length - offset, Math.round(SAMPLE_RATE * tail));
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const { amp, decay, ratio } of partials) {
      sample += amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * freq * ratio * t);
    }
    buffer[offset + i] += gain * Math.min(1, t / attack) * sample;
  }
};

const addMallet = (
  buffer: Float64Array,
  start: number,
  gain: number,
  seed: number,
  { cutoff, decay }: { cutoff: number; decay: number },
) => {
  const random = mulberry32(seed);
  const offset = Math.round(SAMPLE_RATE * start);
  const coefficient = cutoff / SAMPLE_RATE;
  let lowpass = 0;
  for (let i = 0; i < Math.round(SAMPLE_RATE * 0.02); i += 1) {
    lowpass += coefficient * (random() - lowpass);
    buffer[offset + i] += gain * lowpass * Math.exp((-decay * i) / SAMPLE_RATE);
  }
};

const render = (instrument: Instrument, notes: Note[], duration: number) => {
  const buffer = new Float64Array(Math.round(SAMPLE_RATE * duration));

  for (const [index, { gain, ratio, start }] of notes.entries()) {
    const freq = ROOT * ratio * instrument.transpose;
    addVoice(buffer, {
      attack: instrument.attack,
      freq,
      gain,
      partials: instrument.body,
      start,
      tail: instrument.tail,
    });
    if (instrument.mallet)
      addMallet(buffer, start, instrument.mallet.gain * gain, 7 + 4 * index, instrument.mallet);
    if (instrument.shimmer) {
      const { attack, delay, gain: shimmerGain, mul, partials, tail } = instrument.shimmer;
      addVoice(buffer, {
        attack,
        freq: freq * mul,
        gain: shimmerGain * gain,
        partials,
        start: start + delay,
        tail,
      });
    }
  }

  let peak = 0;
  for (const value of buffer) peak = Math.max(peak, Math.abs(value));

  // The tail is still audible at the cut; the fade only kills the step, a longer
  // taper would swallow the bloom that gives the chime its depth.
  const fadeLength = Math.round(SAMPLE_RATE * FADE_OUT);
  const fadeStart = buffer.length - fadeLength;
  const samples = new Int16Array(buffer.length);
  for (const [i, element] of buffer.entries()) {
    let value = (element / peak) * PEAK;
    if (i > fadeStart) value *= (buffer.length - i) / fadeLength;
    samples[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32_767);
  }
  return samples;
};

const toAiff = (samples: Int16Array) => {
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, sample] of samples.entries()) data.writeInt16BE(sample, i * 2);

  const rate = Buffer.alloc(10);
  const exponent = Math.floor(Math.log2(SAMPLE_RATE));
  rate.writeUInt16BE(16_383 + exponent, 0);
  rate.writeBigUInt64BE(BigInt(Math.round((SAMPLE_RATE / 2 ** exponent) * 2 ** 31)) << 32n, 2);

  const comm = Buffer.alloc(26);
  comm.write('COMM', 0);
  comm.writeUInt32BE(18, 4);
  comm.writeUInt16BE(1, 8);
  comm.writeUInt32BE(samples.length, 10);
  comm.writeUInt16BE(16, 14);
  rate.copy(comm, 16);

  const ssnd = Buffer.alloc(16);
  ssnd.write('SSND', 0);
  ssnd.writeUInt32BE(data.length + 8, 4);

  const form = Buffer.alloc(12);
  form.write('FORM', 0);
  form.writeUInt32BE(4 + comm.length + ssnd.length + data.length, 4);
  form.write('AIFF', 8);
  return Buffer.concat([form, comm, ssnd, data]);
};

const toWav = (samples: Int16Array) => {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

let rendered: { aiff: Buffer; wavs: Record<string, Buffer> } | undefined;

export const renderCompletionSounds = () => {
  if (rendered) return rendered;
  const samples = Object.fromEntries(
    Object.entries(SOUNDS).map(([name, { duration, instrument, notes }]) => [
      name,
      render(instrument, notes, duration),
    ]),
  );
  rendered = {
    aiff: toAiff(samples[BANNER_SOUND.source]),
    wavs: Object.fromEntries(Object.entries(samples).map(([name, s]) => [name, toWav(s)])),
  };
  return rendered;
};

const writeIfChanged = async (file: string, content: Buffer) => {
  const existing = await readFile(file).catch(() => undefined);
  if (existing?.equals(content)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

export const writeCompletionSounds = async ({
  aiffDir,
  wavDir,
}: {
  aiffDir?: string;
  wavDir?: string;
}) => {
  const { aiff, wavs } = renderCompletionSounds();
  const writes = [];
  if (wavDir)
    for (const [name, wav] of Object.entries(wavs))
      writes.push(writeIfChanged(path.join(wavDir, `${name}.wav`), wav));
  if (aiffDir) writes.push(writeIfChanged(path.join(aiffDir, BANNER_SOUND.aiff), aiff));
  await Promise.all(writes);
};

/**
 * The chimes are synthesized rather than checked in: the renderer gets WAVs under
 * `<publicDir>/sounds`, the desktop main build gets the AIFF the macOS banner installs.
 */
export const viteCompletionSounds = (options: { aiffDir?: string } = {}): Plugin => {
  let wavDir: string | undefined;
  return {
    async buildStart() {
      await writeCompletionSounds({ aiffDir: options.aiffDir, wavDir });
    },
    configResolved(config) {
      if (config.publicDir) wavDir = path.join(config.publicDir, 'sounds');
    },
    name: 'lobe-completion-sounds',
  };
};
