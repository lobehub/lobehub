export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

const SSE_HEARTBEAT_EVENT = new TextEncoder().encode('event: heartbeat\ndata: {}\n\n');

const withSSEHeartbeat = (stream: ReadableStream) => {
  const reader = stream.getReader();

  let closed = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let readerReleased = false;

  const clearHeartbeat = () => {
    if (heartbeatTimer === undefined) return;

    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const releaseReader = () => {
    if (readerReleased) return;

    reader.releaseLock();
    readerReleased = true;
  };

  const finish = () => {
    closed = true;
    clearHeartbeat();
    releaseReader();
  };

  return new ReadableStream({
    async cancel(reason) {
      closed = true;
      clearHeartbeat();
      try {
        await reader.cancel(reason);
      } finally {
        releaseReader();
      }
    },
    async pull(controller) {
      if (heartbeatTimer === undefined) {
        heartbeatTimer = setInterval(() => {
          if (!closed) controller.enqueue(SSE_HEARTBEAT_EVENT);
        }, SSE_HEARTBEAT_INTERVAL_MS);
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          finish();
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        if (closed) return;

        finish();
        controller.error(error);
      }
    },
  });
};

export const StreamingResponse = (
  stream: ReadableStream,
  options?: { headers?: Record<string, string> },
) => {
  return new Response(withSSEHeartbeat(stream), {
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      // for Nginx: disable chunk buffering
      'X-Accel-Buffering': 'no',
      ...options?.headers,
    },
  });
};
