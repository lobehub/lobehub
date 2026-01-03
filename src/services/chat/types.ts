import { type FetchSSEOptions } from '@lobechat/fetch-sse';
import { type RuntimeInitialContext, type RuntimeStepContext, type TracePayload } from '@lobechat/types';

export interface FetchOptions extends FetchSSEOptions {
  historySummary?: string;
  /** Initial context for page editor (captured at operation start) */
  initialContext?: RuntimeInitialContext;
  signal?: AbortSignal | undefined;
  /** Step context for page editor (updated each step) */
  stepContext?: RuntimeStepContext;
  trace?: TracePayload;
}
