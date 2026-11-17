import type { ChatToolPayload } from '@lobechat/types';

import type {
  StreamEvent,
  StreamHistoryPage,
} from '@/server/modules/AgentRuntime/StreamEventManager';

import type { Run, RunEvent, RunIntervention } from '../types/run.type';
import { STREAM_CLOSING_EVENTS } from '../types/run.type';
import { toRunToolCall } from './run.service';

/** The part of the stream event manager a run event stream reads. */
export interface RunEventJournal {
  getStreamHistoryPage: (
    operationId: string,
    cursor?: string,
    limit?: number,
  ) => Promise<StreamHistoryPage>;
  /**
   * One bounded wait for events after `lastEventId` (Redis `XREAD BLOCK`), so
   * a followed run costs one blocking read per wake-up instead of a poll.
   */
  readEventsOnce?: (
    operationId: string,
    lastEventId?: string,
    blockMs?: number,
  ) => Promise<{ events: StreamEvent[]; lastEventId: string }>;
}

export interface RunEventStreamOptions {
  /** Resume after this journal id; `0` (default) replays from the start. */
  after?: string;
  /** How long one blocking journal read waits for new events. */
  followBlockMs?: number;
  /** Emit a heartbeat after this long without events. */
  heartbeatMs?: number;
  journal: RunEventJournal;
  /** Close the stream after this long; the client reconnects with `Last-Event-ID`. */
  maxDurationMs?: number;
  /** Delay between journal reads when the journal cannot block. */
  pollMs?: number;
  /** Current public state of the run, read when the journal ends or goes quiet. */
  readRun: () => Promise<RunSnapshot>;
  runId: string;
  signal?: AbortSignal;
  /** Read the run's status after this long without events. */
  statusCheckMs?: number;
}

const PAGE_SIZE = 200;

/** A run's public state and what it waits on. */
export interface RunSnapshot {
  interventions: RunIntervention[];
  run: Run;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** A tool call, bare or wrapped in a tool executor payload (`{ toolCalling }`). */
const asToolCall = (value: unknown) => {
  const wrapped = value as { toolCalling?: ChatToolPayload } | undefined;
  const tool = (wrapped?.toolCalling ?? value) as ChatToolPayload | undefined;
  return tool?.id && tool.apiName ? toRunToolCall(tool) : undefined;
};

/**
 * Translate one runtime journal event into public run events. Internal-only
 * traffic (message patches, relay control, notifications) maps to nothing;
 * `agent_runtime_end` is resolved by the caller from the run's settled state.
 */
export const mapJournalEvent = (event: StreamEvent, runId: string): RunEvent[] => {
  const base = {
    id: event.id ?? null,
    runId,
    stepIndex: event.stepIndex ?? 0,
    timestamp: event.timestamp ?? Date.now(),
  };
  const data = (event.data ?? {}) as Record<string, any>;

  switch (event.type) {
    case 'agent_runtime_init': {
      return [{ ...base, data: {}, type: 'run.started' }];
    }
    case 'step_start': {
      return [{ ...base, data: { llmCalls: Number(data.llmCalls) || 0 }, type: 'step.started' }];
    }
    case 'step_complete': {
      return [{ ...base, data: { llmCalls: Number(data.llmCalls) || 0 }, type: 'step.completed' }];
    }
    case 'stream_chunk': {
      if (data.chunkType === 'text' && typeof data.content === 'string' && data.content)
        return [{ ...base, data: { delta: data.content }, type: 'message.delta' }];
      if (data.chunkType === 'reasoning' && typeof data.reasoning === 'string' && data.reasoning)
        return [{ ...base, data: { delta: data.reasoning }, type: 'reasoning.delta' }];
      return [];
    }
    case 'stream_end': {
      return [
        {
          ...base,
          data: {
            content: typeof data.finalContent === 'string' ? data.finalContent : null,
            reasoning: typeof data.reasoning === 'string' ? data.reasoning : null,
            toolCalls: ((data.toolsCalling ?? []) as unknown[])
              .map(asToolCall)
              .filter((call) => call !== undefined),
          },
          type: 'message.completed',
        },
      ];
    }
    case 'tool_start': {
      const toolCall = asToolCall(data);
      return toolCall ? [{ ...base, data: { toolCall }, type: 'tool_call.started' }] : [];
    }
    case 'tool_end': {
      const toolCall = asToolCall(data.payload);
      if (!toolCall) return [];
      const content = data.result?.content;
      return [
        {
          ...base,
          data: {
            content: typeof content === 'string' ? content : null,
            isSuccess: data.isSuccess !== false,
            toolCall,
          },
          type: 'tool_call.completed',
        },
      ];
    }
    case 'error': {
      return [
        {
          ...base,
          data: {
            error: {
              message: typeof data.error === 'string' ? data.error : 'The step failed',
              type: data.errorType ? String(data.errorType) : null,
            },
          },
          type: 'run.error',
        },
      ];
    }
    default: {
      return [];
    }
  }
};

/**
 * The events that close a run's stream, from its current public state: why it
 * stopped, plus what it waits on. `undefined` while it is still going — which
 * includes `waiting_for_async_tool`: the server's own tools resume it under
 * the same id, so the stream keeps following it.
 */
export const closingEventsOf = (
  { interventions, run }: RunSnapshot,
  base: { id: string | null; runId: string; stepIndex: number; timestamp: number },
): RunEvent[] | undefined => {
  switch (run.status) {
    case 'completed': {
      return [{ ...base, data: { result: run.result }, type: 'run.completed' }];
    }
    case 'failed': {
      return [
        {
          ...base,
          data: { error: run.error ?? { message: 'Run failed', type: null } },
          type: 'run.failed',
        },
      ];
    }
    case 'abandoned': {
      return [
        {
          ...base,
          data: { error: { message: 'The run was abandoned', type: 'abandoned' } },
          type: 'run.failed',
        },
      ];
    }
    case 'cancelled': {
      return [{ ...base, data: {}, type: 'run.cancelled' }];
    }
    case 'waiting_for_human': {
      return [
        { ...base, data: { interventions }, id: null, type: 'intervention.requested' },
        { ...base, data: { status: 'waiting_for_human' }, type: 'run.waiting' },
      ];
    }
    case 'waiting_for_tool_results': {
      return [
        {
          ...base,
          data: { toolCalls: run.pendingToolCalls },
          id: null,
          type: 'tool_results.required',
        },
        { ...base, data: { status: 'waiting_for_tool_results' }, type: 'run.waiting' },
      ];
    }
    default: {
      return undefined;
    }
  }
};

/**
 * A run's public event stream: replays the runtime journal from `after`, then
 * follows it until the run stops (finished, cancelled, or waiting on someone).
 * Yields `null` as a heartbeat. Every journal-backed event carries its journal
 * id, so a client that reconnects with `Last-Event-ID` misses nothing; the
 * closing events are derived from the settled run and carry no id.
 */
export async function* runEventStream({
  after = '0',
  followBlockMs = 5000,
  heartbeatMs = 15_000,
  journal,
  maxDurationMs = 5 * 60_000,
  pollMs = 400,
  readRun,
  runId,
  signal,
  statusCheckMs = 3000,
}: RunEventStreamOptions): AsyncGenerator<RunEvent | null> {
  const deadline = Date.now() + maxDurationMs;
  let cursor = after;
  let lastEvent = Date.now();
  let lastHeartbeat = Date.now();
  // Zero: the first quiet read checks the run at once (it may be long over).
  let lastStatusCheck = 0;
  let lastStepIndex = 0;
  // Replay pages the journal until it is caught up; following it then blocks.
  let replaying = true;

  const closeFromRun = async (id: string | null) =>
    closingEventsOf(await readRun(), {
      id,
      runId,
      stepIndex: lastStepIndex,
      timestamp: Date.now(),
    });

  /** The next batch after the cursor, and whether the journal still exists. */
  const read = async (): Promise<{ available: boolean; events: StreamEvent[]; more: boolean }> => {
    if (!replaying && journal.readEventsOnce) {
      // Never 0: Redis reads `XREAD BLOCK 0` as "wait forever".
      const block = Math.max(1, Math.min(followBlockMs, deadline - Date.now()));
      const { events } = await journal.readEventsOnce(runId, cursor, block);
      return { available: true, events, more: false };
    }
    const page = await journal.getStreamHistoryPage(runId, cursor, PAGE_SIZE);
    if (page.available && !page.hasMore) replaying = false;
    return { available: page.available, events: page.events, more: page.hasMore };
  };

  while (!signal?.aborted && Date.now() < deadline) {
    const startedAt = Date.now();
    const batch = await read();

    if (batch.events.length > 0) {
      lastEvent = Date.now();
      lastHeartbeat = lastEvent;
      for (const event of batch.events) {
        lastStepIndex = event.stepIndex ?? lastStepIndex;
        if (event.id) cursor = event.id;
        if (event.type === 'agent_runtime_end') {
          // The end of the operation: say why, from its settled state. A
          // state not settled yet keeps the stream open for the status check.
          const closing = await closeFromRun(event.id ?? null);
          if (closing) {
            yield* closing;
            return;
          }
          continue;
        }
        for (const mapped of mapJournalEvent(event, runId)) {
          yield mapped;
          if (STREAM_CLOSING_EVENTS.includes(mapped.type)) return;
        }
      }
      if (batch.more) continue;
    }

    // Quiet for a while (or the journal is gone, e.g. expired): the run itself
    // decides. Only a run that has stopped closes the stream; one that has not
    // started writing its journal yet keeps it open.
    const now = Date.now();
    if (now - Math.max(lastEvent, lastStatusCheck) >= statusCheckMs || lastStatusCheck === 0) {
      lastStatusCheck = now;
      const closing = await closeFromRun(null);
      if (closing) {
        // Read once more: events published just before the run settled.
        const tail = await journal.getStreamHistoryPage(runId, cursor, PAGE_SIZE);
        if (!(tail.available && tail.events.length > 0)) {
          yield* closing;
          return;
        }
        replaying = true;
        continue;
      }
    }

    if (Date.now() - lastHeartbeat >= heartbeatMs) {
      lastHeartbeat = Date.now();
      yield null;
    }
    // A read that returned at once with nothing (no blocking journal, or no
    // journal yet) waits before the next one.
    if (batch.events.length === 0 && Date.now() - startedAt < pollMs) {
      await sleep(pollMs - (Date.now() - startedAt), signal);
    }
  }
}
