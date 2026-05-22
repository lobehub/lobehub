import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';

import type { ChatCompletionTool } from '../types/chat';
import { AgentRuntimeErrorType } from '../types/error';
import { AgentRuntimeError } from './createError';

export const TOOL_LIMIT_ERROR_TYPE = 'ToolLimitExceeded' as const;

export class ToolLimitExceededError extends Error {
  readonly type = TOOL_LIMIT_ERROR_TYPE;
  readonly provider: string;
  readonly model: string;
  readonly toolCount: number;
  readonly maxToolCount?: number;
  readonly toolPayloadBytes: number;
  readonly maxToolPayloadBytes?: number;

  constructor(params: {
    maxToolCount?: number;
    maxToolPayloadBytes?: number;
    model: string;
    provider: string;
    toolCount: number;
    toolPayloadBytes: number;
  }) {
    const { provider, model, toolCount, maxToolCount, toolPayloadBytes, maxToolPayloadBytes } =
      params;

    const parts: string[] = [];
    if (maxToolCount !== undefined && toolCount > maxToolCount) {
      parts.push(`工具数量 (${toolCount}) 超过 provider ${provider} 的上限 (${maxToolCount})。`);
    }
    if (maxToolPayloadBytes !== undefined && toolPayloadBytes > maxToolPayloadBytes) {
      const kb = Math.round(toolPayloadBytes / 1024);
      const maxKb = Math.round(maxToolPayloadBytes / 1024);
      parts.push(`工具 payload 大小 (${kb} KB) 超过 provider ${provider} 的上限 (${maxKb} KB)。`);
    }
    parts.push('请减少 MCP server 数量，或切换到无此限制的 provider。');

    super(parts.join(' '));
    this.name = 'ToolLimitExceededError';
    this.provider = provider;
    this.model = model;
    this.toolCount = toolCount;
    this.maxToolCount = maxToolCount;
    this.toolPayloadBytes = toolPayloadBytes;
    this.maxToolPayloadBytes = maxToolPayloadBytes;
  }
}

interface ProviderToolLimits {
  maxToolCount?: number;
  maxToolPayloadBytes?: number;
}

/**
 * Resolve provider-level tool limits from the built-in provider registry.
 * Returns `undefined` when the provider isn't registered (custom providers).
 */
function resolveProviderLimits(providerId: string): ProviderToolLimits | undefined {
  const provider = DEFAULT_MODEL_PROVIDER_LIST.find((p) => p.id === providerId);
  if (!provider?.settings) return undefined;

  const { maxToolCount, maxToolPayloadBytes } = provider.settings;
  if (maxToolCount === undefined && maxToolPayloadBytes === undefined) return undefined;

  return { maxToolCount, maxToolPayloadBytes };
}

function measureToolPayloadBytes(tools: ChatCompletionTool[]): number {
  return new TextEncoder().encode(JSON.stringify(tools)).length;
}

export interface ValidateToolLimitsParams {
  model: string;
  provider: string;
  tools: ChatCompletionTool[];
}

/**
 * Validate that the given tools array does not exceed provider-level limits
 * declared in the provider registry (`settings.maxToolCount`,
 * `settings.maxToolPayloadBytes`).
 *
 * - Throws `ToolLimitExceededError` when limits are violated.
 * - Skips the check silently when the provider has no declared limits
 *   or isn't registered in the built-in list.
 */
export function validateToolLimits({ model, provider, tools }: ValidateToolLimitsParams): void {
  if (!tools || tools.length === 0) return;

  const limits = resolveProviderLimits(provider);
  if (!limits) return;

  const { maxToolCount, maxToolPayloadBytes } = limits;

  const toolPayloadBytes = maxToolPayloadBytes !== undefined ? measureToolPayloadBytes(tools) : 0;

  const countExceeded = maxToolCount !== undefined && tools.length > maxToolCount;
  const sizeExceeded = maxToolPayloadBytes !== undefined && toolPayloadBytes > maxToolPayloadBytes;

  if (!countExceeded && !sizeExceeded) return;

  throw new ToolLimitExceededError({
    maxToolCount,
    maxToolPayloadBytes,
    model,
    provider,
    toolCount: tools.length,
    toolPayloadBytes,
  });
}

/**
 * Convenience wrapper that re-throws as an `AgentRuntimeError` so the runtime
 * error handler can surface a structured llm_error event to the caller.
 */
export function assertToolLimits(params: ValidateToolLimitsParams): void {
  try {
    validateToolLimits(params);
  } catch (error) {
    if (error instanceof ToolLimitExceededError) {
      throw AgentRuntimeError.chat({
        endpoint: undefined,
        error: {
          maxToolCount: error.maxToolCount,
          maxToolPayloadBytes: error.maxToolPayloadBytes,
          message: error.message,
          toolCount: error.toolCount,
          toolPayloadBytes: error.toolPayloadBytes,
        },
        errorType: AgentRuntimeErrorType.ExceededToolLimit,
        provider: params.provider,
      });
    }
    throw error;
  }
}
