import { isRecord, toRecord } from '@lobechat/utils/object';

import type { HeterogeneousAgentEvent, ToolCallPayload } from '../types';

/**
 * Shared stream/step lifecycle for ACP `sessionUpdate` adapters.
 *
 * ACP does not frame model rounds explicitly, so adapters detect step
 * boundaries themselves (tool completion, response completion, …) and set
 * {@link pendingStepBoundary}. The next `ensureStream(true)` call consumes the
 * boundary: it closes the open stream, bumps `stepIndex`, resets the per-step
 * tool list, and re-opens a stream whose `stream_start` payload comes from the
 * adapter-provided builder (which appends `newStep` for steps > 0).
 */
export class AcpStreamLifecycle {
  /** Set by the adapter when the next model round must open a new step. */
  pendingStepBoundary = false;
  stepIndex = 0;
  /** Tool calls announced within the current step (reset at each boundary). */
  stepTools: ToolCallPayload[] = [];
  streamOpen = false;

  constructor(private readonly buildStreamStartData: (stepIndex: number) => unknown) {}

  event(type: HeterogeneousAgentEvent['type'], data: unknown): HeterogeneousAgentEvent {
    return { data, stepIndex: this.stepIndex, timestamp: Date.now(), type };
  }

  ensureStream(consumeStepBoundary: boolean): HeterogeneousAgentEvent[] {
    const events: HeterogeneousAgentEvent[] = [];
    if (consumeStepBoundary && this.pendingStepBoundary) {
      events.push(...this.closeStream());
      this.pendingStepBoundary = false;
      this.stepIndex += 1;
      this.stepTools = [];
    }
    if (this.streamOpen) return events;

    this.streamOpen = true;
    events.push(this.event('stream_start', this.buildStreamStartData(this.stepIndex)));
    return events;
  }

  closeStream(data: unknown = {}): HeterogeneousAgentEvent[] {
    if (!this.streamOpen) return [];
    this.streamOpen = false;
    return [this.event('stream_end', data)];
  }
}

/**
 * Read the text out of one ACP ContentBlock-ish value: plain strings, `text`
 * blocks, nested `content` wrappers, and the `diff` / `output` string fields
 * some agents put on tool-call content.
 */
export const acpContentBlockText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (isRecord(value.content)) return acpContentBlockText(value.content);
  if (typeof value.diff === 'string') return value.diff;
  if (typeof value.output === 'string') return value.output;
  return '';
};

/**
 * ACP extension marker for replayed history: `_meta.isReplay` on either the
 * notification `params` or the nested `update`.
 */
export const isAcpReplayMessage = (raw: unknown): boolean => {
  const params = toRecord(toRecord(raw)?.params);
  const update = toRecord(params?.update);
  return toRecord(params?._meta)?.isReplay === true || toRecord(update?._meta)?.isReplay === true;
};

/** ACP extension dedup marker: `_meta.eventId` on the notification `params`. */
export const acpEventIdOf = (raw: unknown): string | undefined => {
  const meta = toRecord(toRecord(toRecord(raw)?.params)?._meta);
  return typeof meta?.eventId === 'string' ? meta.eventId : undefined;
};
