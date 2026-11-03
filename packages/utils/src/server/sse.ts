/**
 * SSE (Server-Sent Events) utilities for agent streaming
 */

export interface SSEEvent {
  data: any;
  event?: string;
  id?: string;
  retry?: number;
}

/**
 * Formats data into SSE format with id/event/data structure
 * @param event - The SSE event configuration
 * @returns Formatted SSE string
 */
export function formatSSEEvent({ id, event, data, retry }: SSEEvent): string {
  const lines: string[] = [];

  if (id !== undefined) {
    lines.push(`id: ${id}`);
  }

  if (event !== undefined) {
    lines.push(`event: ${event}`);
  }

  if (retry !== undefined) {
    lines.push(`retry: ${retry}`);
  }

  // Handle data serialization
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);

  // Split multi-line data and prefix each line with "data: "
  const dataLines = dataString.split('\n');
  dataLines.forEach((line) => {
    lines.push(`data: ${line}`);
  });

  // End with double newline
  lines.push('', '');

  return lines.join('\n');
}

/**
 * Creates a utility for enqueueing SSE events to a ReadableStream controller
 * @param controller - The ReadableStreamDefaultController
 * @returns Helper function for sending SSE events
 */
export function createSSEWriter(controller: ReadableStreamDefaultController<string>) {
  return {
    /**
     * Send a connection event
     */
    writeConnection(operationId: string, lastEventId: string, timestamp: number = Date.now()) {
      this.writeEvent({
        data: {
          lastEventId,
          operationId,
          timestamp,
          type: 'connected',
        },
        event: 'connected',
        id: `conn_${timestamp}`,
      });
    },

    /**
     * Send an error event
     */
    writeError(error: any, operationId: string, phase?: string, timestamp: number = Date.now()) {
      this.writeEvent({
        data: {
          data: {
            error: error.message || String(error),
            phase: phase || 'unknown',
            ...(error.stack && { stack: error.stack }),
          },
          operationId,
          timestamp,
          type: 'error',
        },
        event: 'error',
        id: `error_${timestamp}`,
      });
    },

    /**
     * Send an SSE event
     */
    writeEvent(event: SSEEvent) {
      controller.enqueue(formatSSEEvent(event));
    },

    /**
     * Send a heartbeat/keep-alive event
     */
    writeHeartbeat(timestamp: number = Date.now()) {
      this.writeEvent({
        data: {
          timestamp,
          type: 'heartbeat',
        },
        event: 'heartbeat',
        id: `heartbeat_${timestamp}`,
      });
    },

    /**
     * Send a stream event (for historical or real-time events)
     */
    writeStreamEvent(eventData: any, eventId?: string) {
      this.writeEvent({
        data: eventData,
        event: eventData.type || 'stream',
        id: eventId || `event_${Date.now()}`,
      });
    },
  };
}

/**
 * Agent stream event types
 */
export type AgentStreamEventType =
  | 'connected'
  | 'stream'
  | 'error'
  | 'heartbeat'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'stream_error';

/**
 * Creates SSE headers for agent streaming
 */

export function createSSEHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  };
}
