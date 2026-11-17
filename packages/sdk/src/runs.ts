import type { Options } from './generated/sdk.gen';
import { Runs } from './generated/sdk.gen';
import type {
  CreateRunResult,
  GetApiV1RunsByIdEventsData,
  PostApiV1RunsData,
  Run,
  RunEvent,
  RunStatus,
} from './generated/types.gen';
import { parseServerSentEvents } from './streaming';

/** Event types after which the server closes a run's stream. */
const CLOSING_EVENTS = new Set<RunEvent['type']>([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.waiting',
]);

/** Statuses `runs.wait()` returns on: finished, or waiting on you. */
const SETTLED_STATUSES = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
  'abandoned',
  'waiting_for_human',
  'waiting_for_tool_results',
]);

/** Reconnects in a row that bring no new event before the stream gives up. */
const MAX_IDLE_RECONNECTS = 5;

export type RunEventsRequestOptions = Omit<
  Options<GetApiV1RunsByIdEventsData, true>,
  'headers' | 'parseAs' | 'path' | 'query' | 'throwOnError'
>;

export interface RunStreamOptions extends RunEventsRequestOptions {
  /** Resume after this event id instead of replaying the run from its start. */
  after?: string;
  /**
   * Reconnect (with `Last-Event-ID`) when the server ends the stream before a
   * closing event — it does so every few minutes. Default `true`.
   */
  reconnect?: boolean;
}

export interface RunWaitOptions {
  /**
   * Follow `continuedByRunId` to the run that carries on after an intervention
   * was resolved, and resolve with that one. Default `true`.
   */
  followContinuations?: boolean;
  /** Delay between status reads, in ms. Default 1000. */
  pollInterval?: number;
  signal?: AbortSignal;
  /** Give up after this many ms (rejects). Default: no limit. */
  timeout?: number;
}

/**
 * `runs.stream()` result: iterate it for typed run events, or await
 * `finalEvent()` for the event that ended the stream (`run.completed`,
 * `run.failed`, `run.cancelled` or `run.waiting`). Iterate it once; `abort()`
 * (or breaking out of the loop) closes the connection.
 */
export class RunStream implements AsyncIterable<RunEvent> {
  readonly controller = new AbortController();
  /** Id of the last event received; resume a later stream from it. */
  lastEventId?: string;
  #consumed = false;
  #final?: RunEvent;
  readonly #open: (signal: AbortSignal, after?: string) => Promise<ReadableStream<Uint8Array>>;
  readonly #reconnect: boolean;

  constructor(
    readonly runId: string,
    open: (signal: AbortSignal, after?: string) => Promise<ReadableStream<Uint8Array>>,
    options: { after?: string; reconnect?: boolean } = {},
  ) {
    this.#open = open;
    this.#reconnect = options.reconnect ?? true;
    this.lastEventId = options.after;
  }

  abort() {
    this.controller.abort();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    if (this.#consumed) throw new Error('A RunStream can only be iterated once');
    this.#consumed = true;

    let idleReconnects = 0;
    try {
      while (!this.controller.signal.aborted) {
        const body = await this.#open(this.controller.signal, this.lastEventId);
        let received = false;
        for await (const message of parseServerSentEvents(body)) {
          if (!message.data) continue;
          const event = JSON.parse(message.data) as RunEvent;
          received = true;
          if (event.id) this.lastEventId = event.id;
          yield event;
          if (CLOSING_EVENTS.has(event.type)) {
            this.#final = event;
            return;
          }
        }
        // The server closed early (its time limit): pick up where it stopped.
        if (!this.#reconnect) return;
        idleReconnects = received ? 0 : idleReconnects + 1;
        if (idleReconnects >= MAX_IDLE_RECONNECTS)
          throw new Error('The run event stream keeps closing without new events');
      }
    } finally {
      if (!this.controller.signal.aborted) this.controller.abort();
    }
  }

  /** Drain the stream and resolve with the event that ended it. */
  async finalEvent(): Promise<RunEvent> {
    if (!this.#consumed) {
      for await (const _ of this) {
        // drain
      }
    }
    if (!this.#final) throw new Error('The stream ended without a closing run event');
    return this.#final;
  }
}

/** Abort when any of `signals` does (see `client.ts` for the fallback's rationale). */
const anySignal = (signals: AbortSignal[]) => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  }
  return controller.signal;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** `lobehub.runs`, plus typed event streaming and waiting. */
export class RunsResource extends Runs {
  /**
   * Iterate a run's typed events, replayed from its start (or `after`):
   *
   * ```ts
   * for await (const event of lobehub.runs.stream(runId)) {
   *   if (event.type === 'message.delta') process.stdout.write(event.data.delta);
   * }
   * ```
   */
  stream(id: string, options: RunStreamOptions = {}): RunStream {
    const { after, reconnect, ...requestOptions } = options;
    return new RunStream(
      id,
      async (signal, lastEventId) => {
        const { response } = await this.events({
          ...requestOptions,
          client: requestOptions.client ?? this.client,
          headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined,
          parseAs: 'stream',
          path: { id },
          // Closing the stream must not abort a caller-owned signal, and vice versa.
          signal: requestOptions.signal ? anySignal([requestOptions.signal, signal]) : signal,
          throwOnError: true,
        });
        if (!response.body) throw new Error('The event stream response has no body');
        return response.body;
      },
      { after, reconnect },
    );
  }

  /**
   * Start a run and stream its events:
   *
   * ```ts
   * const stream = await lobehub.runs.createAndStream({ agentId, input: 'Hi' });
   * for await (const event of stream) console.log(event.type);
   * ```
   */
  async createAndStream(
    body: PostApiV1RunsData['body'],
    options: RunStreamOptions = {},
  ): Promise<RunStream & { run: CreateRunResult }> {
    const { data } = await this.create({
      body,
      client: options.client ?? this.client,
      signal: options.signal,
      throwOnError: true,
    });
    const run = data.data;
    if (!run.id) throw new Error('A scheduled run has no events to stream yet');
    return Object.assign(this.stream(run.id, options), { run });
  }

  /**
   * Poll a run until it finishes or waits on you (an intervention, or results
   * of your own tools), following it into the run that continues it after an
   * intervention was resolved.
   */
  async wait(id: string, options: RunWaitOptions = {}): Promise<Run> {
    const { followContinuations = true, pollInterval = 1000, signal, timeout } = options;
    const deadline = timeout === undefined ? undefined : Date.now() + timeout;
    let runId = id;

    while (true) {
      const { data } = await this.get({
        client: this.client,
        path: { id: runId },
        signal,
        throwOnError: true,
      });
      const run = data.data;
      if (followContinuations && run.continuedByRunId) {
        runId = run.continuedByRunId;
        continue;
      }
      if (SETTLED_STATUSES.has(run.status)) return run;
      if (deadline !== undefined && Date.now() + pollInterval > deadline) {
        throw new Error(`Run ${runId} is still ${run.status} after ${timeout}ms`);
      }
      await sleep(pollInterval, signal);
    }
  }
}
