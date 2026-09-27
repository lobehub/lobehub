import { imagePlaceholder } from '../imageEcho';
import type {
  AgentEventAdapter,
  HeterogeneousAgentEvent,
  HeterogeneousToolResultImage,
  ToolCallPayload,
  ToolResultData,
} from '../types';

const KIMI_CODE_IDENTIFIER = 'kimi-code';

const DATA_URL_RE = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s;

/**
 * Kimi Code tool results may be an OpenAI-style content-part array — e.g.
 * `ReadMediaFile` returns `text` parts wrapping an `image_url` part carrying a
 * base64 data URL. Lift images onto `pluginState.images` (the runtime pipeline
 * uploads them) and leave an `[Image: …]` placeholder in the text, which the
 * pipeline rewrites into a markdown image URL once uploaded.
 */
const normalizeToolResultContent = (
  raw: unknown,
): Pick<ToolResultData, 'content' | 'pluginState'> => {
  if (typeof raw === 'string') return { content: raw };
  if (!Array.isArray(raw)) return { content: JSON.stringify(raw ?? '') };

  const images: HeterogeneousToolResultImage[] = [];
  const parts = raw.map((part): string => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    const block = part as Record<string, any>;
    if (block.type === 'text') return typeof block.text === 'string' ? block.text : '';
    if (block.type === 'image_url') {
      const imageUrl = block.image_url ?? block.imageUrl;
      const url = typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
      if (typeof url !== 'string') return '';
      const match = DATA_URL_RE.exec(url);
      if (match) {
        const mediaType = match[1] || 'image';
        images.push({ data: match[2], mediaType });
        return imagePlaceholder(mediaType);
      }
      images.push({ mediaType: 'image', url });
      return imagePlaceholder('image');
    }
    return JSON.stringify(block);
  });

  return {
    content: parts.filter(Boolean).join('\n'),
    ...(images.length > 0 ? { pluginState: { images } } : {}),
  };
};

interface PendingToolCall {
  stepIndex: number;
  toolCalling: ToolCallPayload;
}

/** Maps MoonshotAI Kimi Code's stream-json JSONL protocol into shared stream events. */
export class KimiCodeAdapter implements AgentEventAdapter {
  sessionId?: string;

  private flushed = false;
  private hasToolResultSinceAssistant = false;
  private pendingTools = new Map<string, PendingToolCall>();
  private settledTools = new Set<string>();
  private stepIndex = 0;
  private stepToolCalls: ToolCallPayload[] = [];
  private streamOpen = false;

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    if (this.flushed || !raw || typeof raw !== 'object') return [];
    const event = raw as Record<string, unknown>;

    if (event.role === 'meta' && event.type === 'session.resume_hint') {
      if (typeof event.session_id === 'string') this.sessionId = event.session_id;
      return [];
    }
    if (event.role === 'meta' && event.type === 'turn.step.retrying') {
      return [
        this.makeEvent('stream_retry', {
          agentType: KIMI_CODE_IDENTIFIER,
          attempt: event.next_attempt,
          delay: event.delay_ms,
          delayMs: event.delay_ms,
          error: event.error_message,
          errorName: event.error_name,
          failedAttempt: event.failed_attempt,
          max: event.max_attempts,
          maxAttempts: event.max_attempts,
          provider: KIMI_CODE_IDENTIFIER,
          status: event.status_code,
          statusCode: event.status_code,
        }),
      ];
    }
    if (event.role === 'assistant') return this.handleAssistant(event);
    if (event.role === 'tool') return this.handleToolResult(event);
    return [];
  }

  flush(): HeterogeneousAgentEvent[] {
    if (this.flushed) return [];
    this.flushed = true;
    const events: HeterogeneousAgentEvent[] = [];

    for (const [toolCallId] of this.pendingTools) {
      const pending = this.pendingTools.get(toolCallId)!;
      const content = 'Kimi Code ended before this tool returned a result.';
      events.push(
        this.makeEvent(
          'tool_result',
          {
            content,
            isError: true,
            toolCallId,
          },
          pending.stepIndex,
        ),
        this.makeEvent(
          'tool_end',
          {
            isSuccess: false,
            payload: { toolCalling: pending.toolCalling },
            result: { content, success: false },
            toolCallId,
          },
          pending.stepIndex,
        ),
      );
      this.settledTools.add(toolCallId);
    }
    this.pendingTools.clear();
    if (this.streamOpen) {
      this.streamOpen = false;
      events.push(this.makeEvent('stream_end', {}));
    }
    return events;
  }

  private handleAssistant(event: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const calls = this.parseToolCalls(event.tool_calls);
    const content = typeof event.content === 'string' ? event.content : '';
    if (!content && calls.length === 0) return [];

    const events: HeterogeneousAgentEvent[] = [];
    if (!this.streamOpen) {
      this.streamOpen = true;
      events.push(
        this.makeEvent('stream_start', {
          provider: KIMI_CODE_IDENTIFIER,
          sessionId: this.sessionId,
        }),
      );
    } else if (this.hasToolResultSinceAssistant) {
      events.push(this.makeEvent('stream_end', {}));
      this.stepIndex += 1;
      this.stepToolCalls = [];
      events.push(
        this.makeEvent('stream_start', {
          newStep: true,
          provider: KIMI_CODE_IDENTIFIER,
          sessionId: this.sessionId,
        }),
      );
    }
    this.hasToolResultSinceAssistant = false;

    if (content) {
      events.push(this.makeEvent('stream_chunk', { chunkType: 'text', content }));
    }

    const newCalls = calls.filter(
      (call) => !this.pendingTools.has(call.id) && !this.settledTools.has(call.id),
    );
    if (newCalls.length > 0) {
      for (const call of newCalls) {
        this.pendingTools.set(call.id, { stepIndex: this.stepIndex, toolCalling: call });
        this.stepToolCalls.push(call);
      }
      events.push(
        this.makeEvent('stream_chunk', {
          chunkType: 'tools_calling',
          toolsCalling: [...this.stepToolCalls],
        }),
      );
    }
    return events;
  }

  private handleToolResult(event: Record<string, unknown>): HeterogeneousAgentEvent[] {
    const toolCallId = event.tool_call_id;
    if (
      typeof toolCallId !== 'string' ||
      !this.pendingTools.has(toolCallId) ||
      this.settledTools.has(toolCallId)
    ) {
      return [];
    }
    const pending = this.pendingTools.get(toolCallId)!;
    this.pendingTools.delete(toolCallId);
    this.settledTools.add(toolCallId);
    this.hasToolResultSinceAssistant = true;
    const result: ToolResultData = {
      ...normalizeToolResultContent(event.content),
      isError: false,
      toolCallId,
    };
    return [
      this.makeEvent('tool_result', result, pending.stepIndex),
      this.makeEvent(
        'tool_end',
        {
          isSuccess: true,
          payload: { toolCalling: pending.toolCalling },
          result: { content: result.content, success: true },
          toolCallId,
        },
        pending.stepIndex,
      ),
    ];
  }

  private parseToolCalls(value: unknown): ToolCallPayload[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap((item): ToolCallPayload[] => {
      if (!item || typeof item !== 'object') return [];
      const rawCall = item as Record<string, unknown>;
      const fn = rawCall.function;
      if (
        typeof rawCall.id !== 'string' ||
        !fn ||
        typeof fn !== 'object' ||
        typeof (fn as Record<string, unknown>).name !== 'string'
      ) {
        return [];
      }

      return [
        {
          apiName: (fn as Record<string, unknown>).name as string,
          arguments:
            typeof (fn as Record<string, unknown>).arguments === 'string'
              ? ((fn as Record<string, unknown>).arguments as string)
              : '{}',
          id: rawCall.id,
          identifier: KIMI_CODE_IDENTIFIER,
          type: 'default',
        },
      ];
    });
  }

  private makeEvent(
    type: HeterogeneousAgentEvent['type'],
    data: unknown,
    stepIndex = this.stepIndex,
  ): HeterogeneousAgentEvent {
    return { data, stepIndex, timestamp: Date.now(), type };
  }
}
