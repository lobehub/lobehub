import type { DictationConnection } from './connection';
import { closeDictationSocket } from './connection';
import { REALTIME_ASR_DEFERRED_LIMITS } from './contract';

interface PrefetchEntry {
  abortController: AbortController;
  connection?: DictationConnection;
  expiresAt?: number;
  ready: Promise<DictationConnection | undefined>;
  releaseIdleListeners?: () => void;
}

const SOCKET_OPEN = 1;
// Hand a prefetched session over well before the Gateway's idle deadline so a
// press never races its expiry.
const PREFETCH_EXPIRY_MARGIN_MS = 10_000;
// Failed prefetches back off exponentially with jitter so an outage is not
// amplified by every open composer; a real press never waits on this.
const PREFETCH_RETRY_BASE_MS = 30_000;
const PREFETCH_RETRY_MAX_MS = 600_000;
// A press waits this long for a prefetch still in flight, then connects on its
// own, so a hung admission request cannot block every later press.
const PREFETCH_TAKE_TIMEOUT_MS = 3000;

export class DictationPrefetcher {
  readonly #connect: (signal: AbortSignal) => Promise<DictationConnection>;
  readonly #now: () => number;
  readonly #random: () => number;
  #entry?: PrefetchEntry;
  #failures = 0;
  #retryAt = 0;
  #unsupported = false;

  constructor(options: {
    connect: (signal: AbortSignal) => Promise<DictationConnection>;
    now: () => number;
    random?: () => number;
  }) {
    this.#connect = options.connect;
    this.#now = options.now;
    this.#random = options.random ?? Math.random;
  }

  async prefetch() {
    if (this.#unsupported || this.#now() < this.#retryAt) return;
    const existing = this.#entry;
    if (existing && (!existing.connection || (existing.expiresAt ?? 0) > this.#now())) return;

    this.discard();
    const abortController = new AbortController();
    const entry: PrefetchEntry = { abortController, ready: Promise.resolve(undefined) };
    this.#entry = entry;
    entry.ready = this.#connect(abortController.signal)
      .then((connection) => this.#hold(entry, connection))
      .catch(() => {
        if (this.#entry === entry) this.#entry = undefined;
        if (!abortController.signal.aborted) this.#recordFailure();
        return undefined;
      });
    await entry.ready;
  }

  async take(): Promise<DictationConnection | undefined> {
    const entry = this.#entry;
    if (!entry) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = await Promise.race([
      entry.ready,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), PREFETCH_TAKE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (this.#entry !== entry) return;
    if (
      connection &&
      (entry.expiresAt ?? 0) > this.#now() &&
      connection.socket.readyState === SOCKET_OPEN
    ) {
      entry.releaseIdleListeners?.();
      this.#entry = undefined;
      return connection;
    }
    this.discard();
  }

  resetBackoff() {
    this.#failures = 0;
    this.#retryAt = 0;
  }

  discard() {
    const entry = this.#entry;
    if (!entry) return;
    this.#entry = undefined;
    entry.abortController.abort();
    entry.releaseIdleListeners?.();
    if (entry.connection) closeDictationSocket(entry.connection.socket);
  }

  #hold(entry: PrefetchEntry, connection: DictationConnection) {
    if (this.#entry !== entry || !connection.deferred) {
      if (!connection.deferred) this.#unsupported = true;
      if (this.#entry === entry) this.#entry = undefined;
      closeDictationSocket(connection.socket);
      return undefined;
    }

    // Any event on an idle prefetched session (for example its idle expiry)
    // or a dropped connection makes it unusable for the next press.
    const drop = () => {
      if (this.#entry !== entry) return;
      if ((entry.expiresAt ?? 0) > this.#now()) this.#recordFailure();
      this.discard();
    };
    connection.socket.addEventListener('message', drop);
    connection.socket.addEventListener('error', drop);
    connection.socket.addEventListener('close', drop);
    this.resetBackoff();
    entry.connection = connection;
    entry.expiresAt =
      this.#now() + REALTIME_ASR_DEFERRED_LIMITS.acceptedIdleTimeoutMs - PREFETCH_EXPIRY_MARGIN_MS;
    entry.releaseIdleListeners = () => {
      connection.socket.removeEventListener('message', drop);
      connection.socket.removeEventListener('error', drop);
      connection.socket.removeEventListener('close', drop);
    };
    return connection;
  }

  #recordFailure() {
    this.#failures += 1;
    const delay = Math.min(
      PREFETCH_RETRY_MAX_MS,
      PREFETCH_RETRY_BASE_MS * 2 ** (this.#failures - 1),
    );
    this.#retryAt = this.#now() + delay * (0.5 + this.#random() / 2);
  }
}
