import type { FetchSSEOptions } from '@lobechat/fetch-sse';
import type {
  RequestTrigger,
  RuntimeInitialContext,
  RuntimeStepContext,
  TracePayload,
} from '@lobechat/types';

interface ChatRequestMetadata extends Record<string, unknown> {
  trigger?: RequestTrigger;
}

export interface FetchOptions extends FetchSSEOptions {
  agentId?: string;
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  metadata?: ChatRequestMetadata;
  signal?: AbortSignal | undefined;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  topicId?: string;
  trace?: TracePayload;
}
