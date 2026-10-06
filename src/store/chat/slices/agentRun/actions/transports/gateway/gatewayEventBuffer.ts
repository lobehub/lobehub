import type {
  AgentStreamEvent,
  StreamChunkData,
  ToolStateChunkData,
} from '@lobechat/agent-gateway-client';

const GATEWAY_STREAM_UPDATE_INTERVAL_MS = 300;

type BufferedChunkKind = 'reasoning' | 'text';

interface BufferedChunk {
  data: StreamChunkData;
  event: AgentStreamEvent;
  kind: BufferedChunkKind;
}

interface GatewayEventBufferOptions {
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

const getBufferedChunkKind = (event: AgentStreamEvent): BufferedChunkKind | undefined => {
  if (event.type !== 'stream_chunk') return;

  const chunkType = (event.data as StreamChunkData | undefined)?.chunkType;
  return chunkType === 'text' || chunkType === 'reasoning' ? chunkType : undefined;
};

const getToolStateData = (event: AgentStreamEvent): ToolStateChunkData | undefined => {
  if (event.type !== 'stream_chunk') return;

  const data = event.data as ToolStateChunkData | undefined;
  return data?.chunkType === 'tool_state' ? data : undefined;
};

const getToolStateKey = (event: AgentStreamEvent, data: ToolStateChunkData) =>
  `${event.operationId ?? ''}:${data.toolCallId}`;

const toBufferedChunk = (event: AgentStreamEvent, kind: BufferedChunkKind): BufferedChunk => ({
  data: event.data as StreamChunkData,
  event,
  kind,
});

const mergeBufferedChunk = (
  current: BufferedChunk,
  incomingEvent: AgentStreamEvent,
  incomingData: StreamChunkData,
): BufferedChunk => {
  if (current.data.snapshotMode === 'replace') {
    const currentSequence = current.data.snapshotSeq;
    const incomingSequence = incomingData.snapshotSeq;
    if (
      typeof currentSequence === 'number' &&
      typeof incomingSequence === 'number' &&
      incomingSequence <= currentSequence
    ) {
      return current;
    }

    return toBufferedChunk(incomingEvent, current.kind);
  }

  if (current.kind === 'text') {
    return {
      data: {
        ...incomingData,
        content: `${current.data.content ?? ''}${incomingData.content ?? ''}`,
      },
      event: {
        ...incomingEvent,
        data: {
          ...incomingData,
          content: `${current.data.content ?? ''}${incomingData.content ?? ''}`,
        },
      } as AgentStreamEvent,
      kind: current.kind,
    };
  }

  return {
    data: {
      ...incomingData,
      reasoning: `${current.data.reasoning ?? ''}${incomingData.reasoning ?? ''}`,
    },
    event: {
      ...incomingEvent,
      data: {
        ...incomingData,
        reasoning: `${current.data.reasoning ?? ''}${incomingData.reasoning ?? ''}`,
      },
    } as AgentStreamEvent,
    kind: current.kind,
  };
};

/**
 * Bounds renderer work caused by high-frequency Gateway text deltas.
 *
 * The first chunk is delivered immediately for low time-to-first-token. Further
 * consecutive chunks of the same operation, step, and kind are merged until the
 * update interval expires. Any semantic boundary flushes first, preserving the
 * exact ordering between prose/reasoning, tools, step transitions, and terminal
 * events.
 */
export const createGatewayEventBuffer = (
  listener: (event: AgentStreamEvent) => void,
  options: GatewayEventBufferOptions = {},
) => {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;

  let buffered: BufferedChunk | undefined;
  let lastDeliveredAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bufferedToolStates = new Map<
    string,
    { data: ToolStateChunkData; event: AgentStreamEvent }
  >();
  const lastToolStateDeliveredAt = new Map<string, number>();
  let toolStateTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    unschedule(timer);
    timer = undefined;
  };

  const flush = () => {
    clearTimer();
    if (!buffered) return;

    const event = buffered.event;
    buffered = undefined;
    lastDeliveredAt = now();
    listener(event);
  };

  const scheduleFlush = () => {
    if (timer !== undefined) return;
    const elapsed = now() - lastDeliveredAt;
    timer = schedule(flush, Math.max(0, GATEWAY_STREAM_UPDATE_INTERVAL_MS - elapsed));
  };

  const clearToolStateTimer = () => {
    if (toolStateTimer === undefined) return;
    unschedule(toolStateTimer);
    toolStateTimer = undefined;
  };

  const flushToolStates = (force = true) => {
    clearToolStateTimer();
    const currentTime = now();

    for (const [key, pending] of bufferedToolStates) {
      const deliveredAt = lastToolStateDeliveredAt.get(key) ?? -Infinity;
      if (!force && currentTime - deliveredAt < GATEWAY_STREAM_UPDATE_INTERVAL_MS) continue;

      bufferedToolStates.delete(key);
      lastToolStateDeliveredAt.set(key, currentTime);
      listener(pending.event);
    }

    if (!force && bufferedToolStates.size > 0) {
      const nextDelay = Math.min(
        ...[...bufferedToolStates.keys()].map((key) => {
          const deliveredAt = lastToolStateDeliveredAt.get(key) ?? -Infinity;
          return Math.max(0, GATEWAY_STREAM_UPDATE_INTERVAL_MS - (currentTime - deliveredAt));
        }),
      );
      toolStateTimer = schedule(() => flushToolStates(false), nextDelay);
    }
  };

  const scheduleToolStateFlush = () => {
    if (toolStateTimer !== undefined) return;
    const currentTime = now();
    const nextDelay = Math.min(
      ...[...bufferedToolStates.keys()].map((key) => {
        const deliveredAt = lastToolStateDeliveredAt.get(key) ?? -Infinity;
        return Math.max(0, GATEWAY_STREAM_UPDATE_INTERVAL_MS - (currentTime - deliveredAt));
      }),
    );
    toolStateTimer = schedule(() => flushToolStates(false), nextDelay);
  };

  const pushToolState = (event: AgentStreamEvent, data: ToolStateChunkData) => {
    flush();
    const key = getToolStateKey(event, data);
    const pending = bufferedToolStates.get(key);
    if (pending && data.snapshotSeq <= pending.data.snapshotSeq) return;

    const currentTime = now();
    const deliveredAt = lastToolStateDeliveredAt.get(key) ?? -Infinity;
    if (currentTime - deliveredAt >= GATEWAY_STREAM_UPDATE_INTERVAL_MS) {
      bufferedToolStates.delete(key);
      lastToolStateDeliveredAt.set(key, currentTime);
      listener(event);
      return;
    }

    bufferedToolStates.set(key, { data, event });
    scheduleToolStateFlush();
  };

  const push = (event: AgentStreamEvent) => {
    const toolStateData = getToolStateData(event);
    if (toolStateData) {
      pushToolState(event, toolStateData);
      return;
    }

    // A prose chunk after a tool update is a semantic boundary too. Commit the
    // latest state first so stream ordering remains observable in the renderer.
    flushToolStates();
    const kind = getBufferedChunkKind(event);

    if (!kind) {
      flush();
      listener(event);
      return;
    }

    const data = event.data as StreamChunkData;

    const canMerge =
      buffered?.kind === kind &&
      buffered.event.operationId === event.operationId &&
      buffered.event.stepIndex === event.stepIndex &&
      buffered.data.snapshotMode === data.snapshotMode;

    if (buffered && canMerge) {
      buffered = mergeBufferedChunk(buffered, event, data);
      if (now() - lastDeliveredAt >= GATEWAY_STREAM_UPDATE_INTERVAL_MS) {
        flush();
      } else {
        scheduleFlush();
      }
      return;
    }

    if (buffered) flush();

    if (now() - lastDeliveredAt >= GATEWAY_STREAM_UPDATE_INTERVAL_MS) {
      listener(event);
      lastDeliveredAt = now();
      return;
    }

    buffered = toBufferedChunk(event, kind);
    scheduleFlush();
  };

  return {
    flush: () => {
      flush();
      flushToolStates();
    },
    push,
  };
};
