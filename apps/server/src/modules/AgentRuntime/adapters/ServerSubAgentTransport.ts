import type { SubAgentTransport } from '@lobechat/agent-runtime';
import type {
  ExecSubAgentParams,
  ExecSubAgentResult,
  ExecVirtualSubAgentParams,
} from '@lobechat/types';

import type { RuntimeExecutorContext } from '../context';

const fallbackResult = (error: string): ExecSubAgentResult => ({
  assistantMessageId: '',
  error,
  operationId: '',
  success: false,
  threadId: '',
});

const shareGateBlockedResult = fallbackResult(
  'Sub-agent dispatch is not available for a shared-agent visitor run.',
);

/**
 * Server {@link SubAgentTransport} adapter — delegates child-run creation to
 * callbacks injected by AiAgentService while the package owns executor flow.
 */
export class ServerSubAgentTransport implements SubAgentTransport {
  constructor(private readonly ctx: RuntimeExecutorContext) {}

  async execSubAgent(params: ExecSubAgentParams): Promise<ExecSubAgentResult> {
    // Agent share (defensive layer): a share-visitor run's `ctx.agentShareVisitor` is
    // set from `state.metadata.agentShareVisitor` (see AgentRuntimeService).
    // `callSubAgent`/`callAgent` children built via `execAgentThreadRun` don't
    // thread the parent's `shareGate` through — they'd otherwise execute with
    // the CREATOR's full, unrestricted tool/file/memory surface. The
    // assembly-time defense (the shareGate tool allowlist + `stripSubAgentDispatchApis`)
    // already keeps `callSubAgent` out of the model's tool list for a share
    // run; this is the fail-closed backstop in case that surface is ever
    // reached some other way (e.g. a stale/replayed tool call).
    if (this.ctx.agentShareVisitor) return shareGateBlockedResult;
    if (!this.ctx.execSubAgent) return fallbackResult('Sub-agent dispatch is not available.');

    return this.ctx.execSubAgent(params);
  }

  async execVirtualSubAgent(params: ExecVirtualSubAgentParams): Promise<ExecSubAgentResult> {
    if (this.ctx.agentShareVisitor) return shareGateBlockedResult;
    if (!this.ctx.execVirtualSubAgent) {
      return fallbackResult('Virtual sub-agent dispatch is not available.');
    }

    return this.ctx.execVirtualSubAgent(params);
  }
}
