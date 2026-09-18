import { type LangfuseClient } from '@langfuse/client';
import { propagateAttributes, startObservation } from '@langfuse/tracing';
import { context, isValidTraceId, ROOT_CONTEXT } from '@opentelemetry/api';
import { diffChars } from 'diff';

import {
  type TraceEventBasePayload,
  type TraceEventCopyMessage,
  type TraceEventDeleteAndRegenerateMessage,
  type TraceEventModifyMessage,
  type TraceEventRegenerateMessage,
} from '@/types/trace';

import { getTraceContext } from './index';

/** Trace event scores. */
export enum EventScore {
  DeleteAndRegenerate = -1,
  Regenerate = -0.6,
  Modify = -0.3,
  Copy = 0.6,
}

type EventParams<T> = T & TraceEventBasePayload;

export class TraceEventClient {
  constructor(private client: LangfuseClient) {}

  private async recordEvent(
    params: TraceEventBasePayload,
    scoreName: string,
    value: number,
    output?: string,
  ) {
    const { content, eventType, observationId, traceId, sessionId, userId } = params;
    const parentSpanContext = await getTraceContext(traceId, observationId);
    context.with(ROOT_CONTEXT, () =>
      propagateAttributes({ sessionId, userId }, () => {
        startObservation(
          eventType,
          {
            input: content,
            metadata: {
              ...(output !== undefined && { diffs: diffChars(content, output) }),
              // Historical v3 traces cannot be mutated or used as OTel trace IDs.
              ...(!isValidTraceId(traceId) && { legacyTraceId: traceId }),
              score: value,
            },
            output,
          },
          { asType: 'event', parentSpanContext },
        );
      }),
    );

    if (observationId) {
      // Keep the original IDs so feedback on pre-migration messages still scores the original call.
      this.client.score.create({ name: scoreName, observationId, traceId, value });
    }
  }

  copyMessage(params: EventParams<TraceEventCopyMessage>) {
    return this.recordEvent(params, 'copy message', EventScore.Copy);
  }

  deleteAndRegenerateMessage(params: EventParams<TraceEventDeleteAndRegenerateMessage>) {
    return this.recordEvent(
      params,
      'delete and regenerate message',
      EventScore.DeleteAndRegenerate,
    );
  }

  regenerateMessage(params: EventParams<TraceEventRegenerateMessage>) {
    return this.recordEvent(params, 'regenerate message', EventScore.Regenerate);
  }

  modifyMessage(params: EventParams<TraceEventModifyMessage>) {
    return this.recordEvent(params, 'modify message', EventScore.Modify, params.nextContent);
  }
}
