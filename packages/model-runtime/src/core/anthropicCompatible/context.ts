import type Anthropic from '@anthropic-ai/sdk';

import type { ConstructorOptions } from './index';

/**
 * What the protocol modules read from an Anthropic-compatible runtime. The runtime builds it
 * per call, so its own members stay private and subclasses keep overriding `handleError`.
 */
export interface AnthropicCompatibleRuntimeContext {
  _options: ConstructorOptions;
  baseURL: string;
  client: Anthropic;
  id: string;
  logPrefix: string;
  withMappedRequestModel: <TPayload extends { model?: string }>(
    requestPayload: TPayload,
    logicalModel: string,
  ) => TPayload;
}
