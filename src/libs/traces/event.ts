import { type LangfuseClient } from '@langfuse/client';
import { startObservation } from '@langfuse/tracing';
import { TraceEventType } from '@lobechat/types';
import { diffChars } from 'diff';

import {
  type TraceEventBasePayload,
  type TraceEventCopyMessage,
  type TraceEventDeleteAndRegenerateMessage,
  type TraceEventModifyMessage,
  type TraceEventRegenerateMessage,
} from '@/types/trace';

import { isOtelTraceId, remoteParent } from './ids';

/**
 * Trace event scores
 */
export enum EventScore {
  DeleteAndRegenerate = -1,
  Regenerate = -0.6,
  Modify = -0.3,
  Copy = 0.6,
}

type EventParams<T> = T & TraceEventBasePayload;

interface TraceEventClientParams {
  client: LangfuseClient;
  traceId: string;
}

export class TraceEventClient {
  private _client: LangfuseClient;
  private _traceId: string;

  constructor({ client, traceId }: TraceEventClientParams) {
    this._client = client;
    this._traceId = traceId;
  }

  /**
   * Records a user action on a message as an event in the message's trace, under the generation
   * that produced it when its id is known.
   *
   * Messages traced before the SDK v5 migration carry non-OTel trace ids. Those traces cannot
   * take new observations, so only their score is recorded.
   */
  private recordEvent(
    name: TraceEventType,
    observationId: string | undefined,
    attributes: { input?: unknown; metadata?: Record<string, unknown>; output?: unknown },
  ) {
    if (!isOtelTraceId(this._traceId)) return;

    startObservation(name, attributes, {
      asType: 'event',
      parentSpanContext: remoteParent(this._traceId, observationId),
    });
  }

  private scoreObservation(params: {
    name: string;
    observationId?: string;
    traceId: string;
    value: number;
  }) {
    const { observationId, traceId, value, name } = params;

    // score the observation if there is an id
    if (observationId) {
      this._client.score.create({ name, observationId, traceId, value });
    }
  }

  copyMessage({ traceId, observationId, content }: EventParams<TraceEventCopyMessage>) {
    const score = EventScore.Copy;
    this.recordEvent(TraceEventType.CopyMessage, observationId, {
      input: content,
      metadata: { score },
    });

    // score the observation if there is an id
    this.scoreObservation({
      name: 'copy message',
      observationId,
      traceId,
      value: score,
    });
  }

  async deleteAndRegenerateMessage({
    traceId,
    observationId,
    content,
  }: EventParams<TraceEventDeleteAndRegenerateMessage>) {
    const score = EventScore.DeleteAndRegenerate;
    this.recordEvent(TraceEventType.DeleteAndRegenerateMessage, observationId, {
      input: content,
      metadata: { score },
    });

    // score the observation if there is an id
    this.scoreObservation({
      name: 'delete and regenerate message',
      observationId,
      traceId,
      value: score,
    });
  }

  async regenerateMessage({
    traceId,
    observationId,
    content,
  }: EventParams<TraceEventRegenerateMessage>) {
    const score = EventScore.Regenerate;
    this.recordEvent(TraceEventType.RegenerateMessage, observationId, {
      input: content,
      metadata: { score },
    });

    // score the observation if there is an id
    this.scoreObservation({ name: 'regenerate message', observationId, traceId, value: score });
  }

  async modifyMessage({
    content: prev,
    nextContent: next,
    observationId,
    traceId,
  }: EventParams<TraceEventModifyMessage>) {
    const score = EventScore.Modify;

    const diffs = diffChars(prev, next);
    this.recordEvent(TraceEventType.ModifyMessage, observationId, {
      input: prev,
      metadata: { diffs, score },
      output: next,
    });

    // score the observation if there is an id
    this.scoreObservation({
      name: 'modify message',
      observationId,
      traceId,
      value: score,
    });
  }
}
