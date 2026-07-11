import type { SubAgentTransport } from '@lobechat/agent-runtime';
import type {
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
} from '@lobechat/types';
import { pickString, toRecord } from '@lobechat/utils/object';

import type { RuntimeExecutorContext } from '../context';

const fallbackResult = (error: string): ExecSubAgentResult => ({
  assistantMessageId: '',
  error,
  operationId: '',
  success: false,
  threadId: '',
});

const normalizeResult = (value: unknown): ExecSubAgentResult => {
  const result = toRecord(value);
  if (!result) {
    return {
      assistantMessageId: '',
      operationId: '',
      success: true,
      threadId: '',
    };
  }

  return {
    assistantMessageId: pickString(result.assistantMessageId) ?? '',
    error: pickString(result.error),
    operationId: pickString(result.operationId) ?? '',
    success: result.success !== false,
    threadId: pickString(result.threadId) ?? '',
  };
};

/**
 * Server {@link SubAgentTransport} adapter — delegates child-run creation to
 * callbacks injected by AiAgentService while the package owns executor flow.
 */
export class ServerSubAgentTransport implements SubAgentTransport {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  async execSubAgent(params: ExecSubAgentParams): Promise<ExecSubAgentResult> {
    if (!this.ctx.execSubAgent) return fallbackResult('Sub-agent dispatch is not available.');

    return normalizeResult(await this.ctx.execSubAgent(params));
  }

  async execVirtualSubAgent(params: ExecVirtualSubAgentParams): Promise<ExecSubAgentResult> {
    if (!this.ctx.execVirtualSubAgent) {
      return fallbackResult('Virtual sub-agent dispatch is not available.');
    }

    return normalizeResult(await this.ctx.execVirtualSubAgent(params));
  }
}
