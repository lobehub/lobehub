import { REALTIME_ASR_AUDIO, REALTIME_ASR_LIMITS } from './contract';

export interface FrameWebSocket {
  readonly bufferedAmount: number;
  readonly readyState: number;
  send: (data: ArrayBuffer | string) => void;
}

interface QueueWaiter {
  reject: (reason: Error) => void;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class BoundedWebSocketFrameQueue {
  readonly #frames: ArrayBuffer[] = [];
  readonly #maxBufferedBytes: number;
  readonly #maxFrames: number;
  readonly #socket: FrameWebSocket;
  readonly #waiters = new Set<QueueWaiter>();
  #disposed = false;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    socket: FrameWebSocket,
    options: {
      maxBufferedBytes?: number;
      maxFrames?: number;
    } = {},
  ) {
    this.#socket = socket;
    this.#maxFrames = options.maxFrames ?? REALTIME_ASR_LIMITS.maxBufferedFrames;
    this.#maxBufferedBytes =
      options.maxBufferedBytes ?? REALTIME_ASR_AUDIO.frameBytes * this.#maxFrames;
  }

  get pendingFrames() {
    return this.#frames.length;
  }

  enqueue(frame: ArrayBuffer): boolean {
    if (
      this.#disposed ||
      frame.byteLength !== REALTIME_ASR_AUDIO.frameBytes ||
      this.#frames.length >= this.#maxFrames
    ) {
      return false;
    }

    this.#frames.push(frame);
    this.#drain();
    return true;
  }

  dispose() {
    this.#disposed = true;
    this.#frames.length = 0;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const waiter of this.#waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('frame_queue_disposed'));
    }
    this.#waiters.clear();
  }

  waitForEmpty(timeoutMs = 1000): Promise<void> {
    this.#drain();
    if (this.#frames.length === 0) return Promise.resolve();
    if (this.#disposed) return Promise.reject(new Error('frame_queue_disposed'));

    return new Promise((resolve, reject) => {
      const waiter: QueueWaiter = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new Error('frame_queue_timeout'));
        }, timeoutMs),
      };
      this.#waiters.add(waiter);
      this.#scheduleDrain();
    });
  }

  #drain = () => {
    if (this.#disposed || this.#socket.readyState !== 1) {
      if (this.#frames.length > 0) this.#scheduleDrain();
      return;
    }

    while (
      this.#frames.length > 0 &&
      this.#socket.bufferedAmount + this.#frames[0].byteLength <= this.#maxBufferedBytes
    ) {
      this.#socket.send(this.#frames.shift()!);
    }

    if (this.#frames.length === 0) {
      for (const waiter of this.#waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve();
      }
      this.#waiters.clear();
      return;
    }

    this.#scheduleDrain();
  };

  #scheduleDrain() {
    if (this.#disposed || this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#drain();
    }, 20);
  }
}
