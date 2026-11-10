/** Root-mean-square level of one PCM16 frame, 0 (silence) … 1 (full scale). */
export const frameLevel = (frame: ArrayBuffer): number => {
  const samples = new Int16Array(frame);
  if (samples.length === 0) return 0;

  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length) / 32_768;
};

/** A stretch of the recording sent to speech-to-text as one request. */
export interface LiveWindow {
  endMs: number;
  frames: ArrayBuffer[];
  startMs: number;
  /** Whether any frame rose above the silence floor; silent windows are not transcribed. */
  voiced: boolean;
}

export interface LiveWindowOptions {
  frameMs: number;
  /** Never cut a window longer than this, even mid-sentence. */
  maxMs: number;
  /** Once this long, cut at the next silent frame so words are not split. */
  minMs: number;
  /** Frames quieter than this count as silence. */
  silenceLevel: number;
}

export const DEFAULT_LIVE_WINDOW_OPTIONS: LiveWindowOptions = {
  frameMs: 200,
  maxMs: 12_000,
  minMs: 4000,
  silenceLevel: 0.01,
};

/**
 * Cuts the recorded frames into transcription windows. Offsets are on the
 * recording's own timeline (paused time excluded), which is also the timeline
 * of the uploaded audio, so a live segment can be played back from its offset.
 */
export class LiveWindowCutter {
  readonly #options: LiveWindowOptions;
  #cursorMs = 0;
  #frames: ArrayBuffer[] = [];
  #startMs = 0;
  #voiced = false;

  constructor(options: Partial<LiveWindowOptions> = {}) {
    this.#options = { ...DEFAULT_LIVE_WINDOW_OPTIONS, ...options };
  }

  /** Add one frame; returns a window when this frame closes one. */
  push(frame: ArrayBuffer, level = frameLevel(frame)): LiveWindow | undefined {
    const { frameMs, maxMs, minMs, silenceLevel } = this.#options;
    if (this.#frames.length === 0) this.#startMs = this.#cursorMs;

    this.#frames.push(frame);
    this.#cursorMs += frameMs;
    const silent = level < silenceLevel;
    if (!silent) this.#voiced = true;

    const lengthMs = this.#cursorMs - this.#startMs;
    if (lengthMs >= maxMs || (lengthMs >= minMs && silent)) return this.flush();
    return undefined;
  }

  /** Close the open window now (pause, stop). */
  flush(): LiveWindow | undefined {
    if (this.#frames.length === 0) return undefined;

    const window: LiveWindow = {
      endMs: this.#cursorMs,
      frames: this.#frames,
      startMs: this.#startMs,
      voiced: this.#voiced,
    };
    this.#frames = [];
    this.#voiced = false;
    return window;
  }
}
