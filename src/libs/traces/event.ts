import { TraceEventType } from '@lobechat/types';
import { diffChars } from 'diff';
import { type LangfuseTraceClient } from 'langfuse-core';

import {
  type TraceEventBasePayload,
  type TraceEventCopyMessage,
  type TraceEventDeleteAndRegenerateMessage,
  type TraceEventModifyMessage,
  type TraceEventRegenerateMessage,
} from '@/types/trace';

/**
 * trace 事件得分
 */
export enum EventScore {
  DeleteAndRegenerate = -1,
  Regenerate = -0.6,
  Modify = -0.3,
  Copy = 0.6,
}

type EventParams<T> = T & TraceEventBasePayload;

export class TraceEventClient {
  private _trace: LangfuseTraceClient;
  constructor(client: LangfuseTraceClient) {
    this._trace = client;
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
      this._trace.client.score({ name, observationId, traceId, value });
    }
  }

  copyMessage({ traceId, observationId, content }: EventParams<TraceEventCopyMessage>) {
    const score = EventScore.Copy;
    // create update event
    this._trace?.event({
      input: content,
      metadata: { score },
      name: TraceEventType.CopyMessage,
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
    // create update event
    this._trace?.event({
      input: content,
      metadata: { score },
      name: TraceEventType.DeleteAndRegenerateMessage,
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
    // create update event
    this._trace?.event({
      input: content,
      metadata: { score },
      name: TraceEventType.RegenerateMessage,
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

    // create update event
    const diffs = diffChars(prev, next);
    this._trace?.event({
      input: prev,
      metadata: { diffs, score },
      name: TraceEventType.ModifyMessage,
      output: next,
    });

    this._trace.update({
      output: next,
      // TODO: add tag when supported
      // tags: [TraceNameMap.UserEvents]
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
