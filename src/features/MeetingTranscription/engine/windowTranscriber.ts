import type { FrameLedger } from './frameLedger';
import type {
  LiveErrorCode,
  LiveSegment,
  LiveTranscriber,
  LiveTranscriberEvents,
  LiveTranscriberStatus,
} from './types';
import { FRAME_MS, frameToMs, retryDelay } from './types';

/** After this much audio, a window closes at the next pause. */
export const WINDOW_MIN_FRAMES = 10_000 / FRAME_MS;
/** A window never grows past this, pause or not. */
export const WINDOW_MAX_FRAMES = 25_000 / FRAME_MS;

export class LiveTranscriptionError extends Error {
  constructor(readonly code: LiveErrorCode) {
    super(code);
    this.name = 'LiveTranscriptionError';
  }
}

export interface WindowRequest {
  endMs: number;
  seq: number;
  startMs: number;
  wav: Blob;
}

export interface WindowTranscriberDependencies extends LiveTranscriberEvents {
  ledger: FrameLedger;
  /** Subscribe to the browser coming back online; returns the unsubscribe. */
  onOnline?: (listener: () => void) => () => void;
  /** Transcribe and store one window as realtime segment `seq`. Throws `LiveTranscriptionError`. */
  transcribe: (request: WindowRequest) => Promise<{ text: string }>;
}

interface Window {
  from: number;
  seq: number;
  to: number;
}

const BLOCKING_CODES = new Set<LiveErrorCode>([
  'auth',
  'provider_not_configured',
  'quota_exceeded',
]);

/**
 * Live draft for deployments without a realtime gateway: the recording is cut
 * into 10–25 s windows at pauses, and each window is transcribed by one
 * request that also stores it (`meeting.transcribeLive`).
 *
 * Windows are fixed when cut and keep their `seq` across retries, so a request
 * whose response was lost is simply sent again and replaces the stored row.
 * Windows are sent one at a time in order; while a window fails, later audio
 * queues up in the ledger and is caught up once the provider answers again.
 */
export class WindowTranscriber implements LiveTranscriber {
  readonly #deps: WindowTranscriberDependencies;
  readonly #queue: Window[] = [];
  #attempt = 0;
  #blocked?: LiveErrorCode;
  #cutFrom = 0;
  #disposed = false;
  #drainWaiters = new Set<() => void>();
  #errorCode?: LiveErrorCode;
  #inFlight = false;
  #nextSeq = 0;
  #offOnline?: () => void;
  #retryAt?: number;
  #retryTimer?: ReturnType<typeof setTimeout>;
  #started = false;

  constructor(
    deps: WindowTranscriberDependencies,
    options: { startFrame?: number; startSeq?: number } = {},
  ) {
    this.#deps = deps;
    this.#cutFrom = options.startFrame ?? 0;
    this.#nextSeq = options.startSeq ?? 0;
  }

  readonly start = () => {
    if (this.#started) return;
    this.#started = true;
    this.#offOnline = this.#deps.onOnline?.(() => {
      if (this.#errorCode === 'network') this.retry();
    });
    this.#emitStatus();
  };

  readonly notifyFrame = () => {
    if (!this.#started || this.#disposed) return;
    const { ledger } = this.#deps;
    const size = ledger.length - this.#cutFrom;
    const last = ledger.length - 1;
    if (size >= WINDOW_MAX_FRAMES || (size >= WINDOW_MIN_FRAMES && ledger.isSilent(last))) {
      this.#cut(ledger.length);
    }
    this.#emitStatus();
  };

  readonly pause = () => {
    this.#cut(this.#deps.ledger.length);
  };

  readonly retry = () => {
    if (this.#disposed) return;
    this.#blocked = undefined;
    this.#attempt = 0;
    this.#clearRetry();
    this.#pump();
  };

  readonly drain = async (timeoutMs: number) => {
    this.#cut(this.#deps.ledger.length);
    if (this.#isDrained()) return true;

    return new Promise<boolean>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.#drainWaiters.delete(done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.#drainWaiters.delete(done);
        resolve(false);
      }, timeoutMs);
      this.#drainWaiters.add(done);
    });
  };

  readonly dispose = () => {
    this.#disposed = true;
    this.#clearRetry();
    this.#offOnline?.();
    for (const waiter of this.#drainWaiters) waiter();
  };

  #cut(to: number) {
    if (to <= this.#cutFrom) return;
    this.#queue.push({ from: this.#cutFrom, seq: this.#nextSeq++, to });
    this.#cutFrom = to;
    this.#pump();
  }

  #isDrained() {
    return this.#queue.length === 0 && !this.#inFlight;
  }

  async #pump() {
    if (this.#inFlight || this.#disposed || this.#blocked || this.#retryTimer) return;
    const window = this.#queue[0];
    if (!window) return;

    this.#inFlight = true;
    this.#emitStatus();
    try {
      const { text } = await this.#deps.transcribe({
        endMs: frameToMs(window.to),
        seq: window.seq,
        startMs: frameToMs(window.from),
        wav: this.#deps.ledger.toWav(window.from, window.to),
      });
      if (this.#disposed) return;

      this.#queue.shift();
      this.#attempt = 0;
      this.#errorCode = undefined;
      if (text) {
        const segment: LiveSegment = {
          endMs: frameToMs(window.to),
          seq: window.seq,
          startMs: frameToMs(window.from),
          text,
        };
        this.#deps.onSegments([segment]);
      }
    } catch (error) {
      if (this.#disposed) return;
      const code = error instanceof LiveTranscriptionError ? error.code : 'provider_unavailable';
      this.#errorCode = code;
      if (BLOCKING_CODES.has(code)) {
        this.#blocked = code;
      } else {
        const delay = retryDelay(this.#attempt++);
        this.#retryAt = Date.now() + delay;
        this.#retryTimer = setTimeout(() => {
          this.#retryTimer = undefined;
          this.#retryAt = undefined;
          this.#pump();
        }, delay);
      }
    } finally {
      this.#inFlight = false;
    }

    this.#emitStatus();
    if (this.#isDrained()) {
      for (const waiter of this.#drainWaiters) waiter();
    } else {
      this.#pump();
    }
  }

  #clearRetry() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#retryAt = undefined;
  }

  #emitStatus() {
    const pendingFrom = this.#queue[0]?.from ?? this.#cutFrom;
    const status: LiveTranscriberStatus = {
      pendingMs: frameToMs(Math.max(0, this.#deps.ledger.length - pendingFrom)),
      state: this.#blocked ? 'blocked' : this.#errorCode ? 'reconnecting' : 'live',
    };
    if (this.#errorCode) status.errorCode = this.#errorCode;
    if (this.#retryAt) status.retryInMs = Math.max(0, this.#retryAt - Date.now());
    this.#deps.onStatus(status);
  }
}
