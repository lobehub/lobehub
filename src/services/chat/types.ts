import type { FetchSSEOptions } from '@lobechat/fetch-sse';
import type {
  RequestTrigger,
  RuntimeInitialContext,
  RuntimeStepContext,
  TracePayload,
} from '@lobechat/types';

export interface FetchOptions extends FetchSSEOptions {
  agentId?: string;
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  requestTrigger?: RequestTrigger;
  signal?: AbortSignal | undefined;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  topicId?: string;
  trace?: TracePayload;
}
