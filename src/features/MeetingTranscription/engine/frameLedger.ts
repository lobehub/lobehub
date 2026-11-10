import { FRAME_BYTES, FRAME_MS, SAMPLE_RATE } from './types';

/** RMS (0–1) below which a frame counts as a pause in speech. */
const SILENCE_RMS = 0.012;

const rms = (frame: ArrayBuffer) => {
  const samples = new Int16Array(frame);
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += (sample / 0x8000) ** 2;
  return Math.sqrt(sum / samples.length);
};

/**
 * Every frame of a recording, addressed by a monotonically increasing index.
 *
 * The ledger is the single source of audio for both the live draft and the
 * uploaded recording: live transcribers read frames by index and can re-read
 * any of them after a failure, so a dropped connection never loses audio.
 * Index `n` starts at `n * 200 ms` of recorded (unpaused) time.
 */
export class FrameLedger {
  readonly #frames: ArrayBuffer[] = [];
  readonly #silent: boolean[] = [];
  readonly #listeners = new Set<() => void>();

  get length() {
    return this.#frames.length;
  }

  get durationMs() {
    return this.#frames.length * FRAME_MS;
  }

  append(frame: ArrayBuffer): number {
    if (frame.byteLength !== FRAME_BYTES) throw new Error('invalid_frame_size');
    this.#frames.push(frame);
    this.#silent.push(rms(frame) < SILENCE_RMS);
    for (const listener of this.#listeners) listener();
    return this.#frames.length - 1;
  }

  get(index: number): ArrayBuffer {
    const frame = this.#frames[index];
    if (!frame) throw new Error(`frame_out_of_range:${index}`);
    return frame;
  }

  isSilent(index: number) {
    return this.#silent[index] ?? false;
  }

  /** Mean level of the most recent frames (0–1), for a recording meter. */
  level(frames = 2) {
    const from = Math.max(0, this.#frames.length - frames);
    let sum = 0;
    for (let index = from; index < this.#frames.length; index += 1) {
      sum += rms(this.#frames[index]);
    }
    return this.#frames.length > from ? sum / (this.#frames.length - from) : 0;
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Frames `[from, to)` as one 16 kHz mono PCM16 WAV file. */
  toWav(from = 0, to = this.#frames.length): Blob {
    const dataBytes = (to - from) * FRAME_BYTES;
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeTag = (offset: number, tag: string) => {
      for (let index = 0; index < 4; index += 1)
        view.setUint8(offset + index, tag.charCodeAt(index));
    };
    writeTag(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeTag(8, 'WAVE');
    writeTag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeTag(36, 'data');
    view.setUint32(40, dataBytes, true);

    return new Blob([header, ...this.#frames.slice(from, to)], { type: 'audio/wav' });
  }
}
