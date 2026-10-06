import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import type { CodexApprovalDecision } from '@lobechat/types';
import { isCodexApprovalDecision } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { CommandExecutionApprovalDecision } from './protocol';

/** Bounds an unattended approval so a turn cannot wait forever. */
const DEFAULT_CODEX_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

// The shared decision type must stay identical to the generated protocol union.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const decisionMatchesProtocol: Equal<CodexApprovalDecision, CommandExecutionApprovalDecision> =
  true;
void decisionMatchesProtocol;

export { type CodexApprovalDecision, isCodexApprovalDecision };

/** Compares native decisions by permission fields, independently of JSON key order. */
const matchesApprovalDecision = (candidate: unknown, decision: CodexApprovalDecision): boolean => {
  if (!isCodexApprovalDecision(candidate)) return false;
  if (typeof candidate === 'string' || typeof decision === 'string') return candidate === decision;
  if ('acceptWithExecpolicyAmendment' in candidate && 'acceptWithExecpolicyAmendment' in decision) {
    const expected = candidate.acceptWithExecpolicyAmendment.execpolicy_amendment;
    const actual = decision.acceptWithExecpolicyAmendment.execpolicy_amendment;
    return (
      expected.length === actual.length && expected.every((part, index) => part === actual[index])
    );
  }
  if ('applyNetworkPolicyAmendment' in candidate && 'applyNetworkPolicyAmendment' in decision) {
    const expected = candidate.applyNetworkPolicyAmendment.network_policy_amendment;
    const actual = decision.applyNetworkPolicyAmendment.network_policy_amendment;
    return expected.host === actual.host && expected.action === actual.action;
  }
  return false;
};

/**
 * An unanswered request declines only this action when Codex offers that choice.
 * Codex can omit `decline` (observed on 0.160.0 command approvals); then only
 * `cancel`, which also ends the native turn, is valid.
 */
const getTimeoutDecision = (request: ApprovalRequest): CodexApprovalDecision => {
  const args = isRecord(request.arguments) ? request.arguments : {};
  const allowed = Array.isArray(args.availableDecisions) ? args.availableDecisions : undefined;
  return !allowed || allowed.includes('decline') ? 'decline' : 'cancel';
};

interface ApprovalRequest {
  apiName: 'command_execution' | 'file_change';
  arguments: unknown;
  interventionId: string;
  toolCallId: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: CodexApprovalDecision) => void;
  timer?: ReturnType<typeof setTimeout>;
}

interface CodexApprovalBridgeOptions {
  emit: (event: AgentStreamEvent) => Promise<void> | void;
  operationId: string;
  timeoutMs?: number;
}

/**
 * Bridges one turn's native approvals to the existing intervention surface.
 *
 * Call stack:
 * CodexThreadSession.handleServerRequest
 *   -> {@link CodexApprovalBridge.request}
 *     -> intervention UI
 *       -> {@link CodexApprovalBridge.resolve}
 *
 * Use when: a native command or file edit needs approval.
 * Expects: one bridge per active operation; the host closes it with the turn.
 * Returns: validated decisions; pending requests fail closed on timeout or close.
 */
export class CodexApprovalBridge {
  private closed = false;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly queues = new Map<string, PendingApproval[]>();

  constructor(private readonly options: CodexApprovalBridgeOptions) {}

  /**
   * Parks a native approval and publishes one request per tool at a time.
   *
   * Call stack:
   * CodexThreadSession.handleServerRequest
   *   -> {@link CodexApprovalBridge.request}
   *     -> {@link CodexApprovalBridge.publish}
   *
   * Use when: a Codex command or file edit needs a human decision.
   * Expects: arguments are the unmodified native approval request.
   * Returns: one validated native decision, or cancel on timeout/close.
   */
  async request(request: ApprovalRequest): Promise<CodexApprovalDecision> {
    if (this.closed) return 'cancel';
    // Native item/approval ids can be reused; mint a unique UI callback so a
    // delayed click cannot authorize a later request.
    const uniqueRequest = { ...request, interventionId: globalThis.crypto.randomUUID() };
    return new Promise<CodexApprovalDecision>((resolve) => {
      const entry: PendingApproval = { request: uniqueRequest, resolve };
      this.pending.set(uniqueRequest.interventionId, entry);
      const queue = this.queues.get(request.toolCallId) ?? [];
      queue.push(entry);
      this.queues.set(request.toolCallId, queue);
      if (queue.length === 1) void this.publish(entry);
    });
  }

  /** Publishes the active request with its decision context and bounded lifetime. */
  private async publish(entry: PendingApproval): Promise<void> {
    if (this.closed) return;
    const { request } = entry;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CODEX_APPROVAL_TIMEOUT_MS;
    const timestamp = Date.now();
    entry.timer = setTimeout(() => {
      void this.finish(entry, getTimeoutDecision(request), {
        cancelReason: 'timeout',
        cancelled: true,
      });
    }, timeoutMs);
    entry.timer.unref?.();
    const data: AgentInterventionRequestData = {
      apiName: request.apiName,
      arguments: JSON.stringify(request.arguments ?? {}),
      deadline: timestamp + timeoutMs,
      identifier: 'codex',
      interactionKind: 'permission',
      provider: 'codex',
      interventionId: request.interventionId,
      toolCallId: request.toolCallId,
    };
    try {
      await this.options.emit({
        data,
        operationId: this.options.operationId,
        stepIndex: 0,
        timestamp,
        type: 'agent_intervention_request',
      });
    } catch (error) {
      console.error('Failed to emit Codex approval request:', error);
      await this.finish(entry, 'cancel', { cancelReason: 'session_ended', cancelled: true });
    }
  }

  /** Consumes only the active callback and a decision advertised for that request. */
  resolve(interventionId: string, decision: CodexApprovalDecision): boolean {
    const entry = this.pending.get(interventionId);
    if (!entry || this.queues.get(entry.request.toolCallId)?.[0] !== entry) return false;
    const args = isRecord(entry.request.arguments) ? entry.request.arguments : {};
    const allowed = Array.isArray(args.availableDecisions) ? args.availableDecisions : undefined;
    if (
      decision !== 'cancel' &&
      allowed &&
      !allowed.some((candidate) => matchesApprovalDecision(candidate, decision))
    )
      return false;
    // Structured amendments must be native proposals, never arbitrary IPC input.
    if (typeof decision !== 'string' && !allowed) {
      const exec =
        'acceptWithExecpolicyAmendment' in decision
          ? decision.acceptWithExecpolicyAmendment.execpolicy_amendment
          : undefined;
      const network =
        'applyNetworkPolicyAmendment' in decision
          ? decision.applyNetworkPolicyAmendment.network_policy_amendment
          : undefined;
      if (exec && JSON.stringify(exec) !== JSON.stringify(args.proposedExecpolicyAmendment))
        return false;
      if (
        network &&
        (!Array.isArray(args.proposedNetworkPolicyAmendments) ||
          !args.proposedNetworkPolicyAmendments.some(
            (proposal) =>
              isRecord(proposal) &&
              proposal.host === network.host &&
              proposal.action === network.action,
          ))
      )
        return false;
    }
    void this.finish(entry, decision);
    return true;
  }

  /** Cancels all active and queued callbacks when the owning turn ends. */
  cancelAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      if (this.queues.get(entry.request.toolCallId)?.[0] === entry)
        void this.emitResponse(entry.request, { cancelReason: 'session_ended', cancelled: true });
      entry.resolve('cancel');
    }
    this.pending.clear();
    this.queues.clear();
  }

  /** Settles once, then exposes the next request after terminal publication. */
  private async finish(
    entry: PendingApproval,
    decision: CodexApprovalDecision,
    response?: Pick<AgentInterventionResponseData, 'cancelReason' | 'cancelled'>,
  ): Promise<void> {
    if (!this.pending.delete(entry.request.interventionId)) return;
    clearTimeout(entry.timer);
    if (response) await this.emitResponse(entry.request, response);
    entry.resolve(decision);
    const queue = this.queues.get(entry.request.toolCallId);
    if (queue?.[0] === entry) queue.shift();
    if (!queue?.length) this.queues.delete(entry.request.toolCallId);
    else if (!this.closed) await this.publish(queue[0]);
  }

  private emitResponse(
    request: ApprovalRequest,
    response: Pick<AgentInterventionResponseData, 'cancelReason' | 'cancelled'>,
  ): Promise<void> {
    return Promise.resolve(
      this.options.emit({
        data: {
          ...response,
          interventionId: request.interventionId,
          toolCallId: request.toolCallId,
        } satisfies AgentInterventionResponseData,
        operationId: this.options.operationId,
        stepIndex: 0,
        timestamp: Date.now(),
        type: 'agent_intervention_response',
      }),
    ).catch((error) => {
      console.error('Failed to emit Codex approval response:', error);
    });
  }
}
