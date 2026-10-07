import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';
import type { CodexApprovalDecision } from '@lobechat/types';
import { getCodexApprovalDecisions, isCodexApprovalDecision } from '@lobechat/types';
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
  /** Current tool snapshot, independent of the unmodified native approval payload. */
  toolContext?: unknown;
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
    const args = isRecord(request.arguments) ? request.arguments : {};
    const decisions = getCodexApprovalDecisions(request.apiName, args);
    const data: AgentInterventionRequestData = {
      apiName: request.apiName,
      arguments: JSON.stringify(request.arguments ?? {}),
      deadline: timestamp + timeoutMs,
      identifier: 'codex',
      interactionKind: 'permission',
      provider: 'codex',
      reviewArguments: JSON.stringify(this.reviewArguments(request, decisions)),
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

  /** Builds bounded review context without truncating an authorizable permission scope. */
  private reviewArguments(request: ApprovalRequest, decisions: CodexApprovalDecision[]) {
    const args = isRecord(request.arguments) ? request.arguments : {};
    const context = {
      command: args.command,
      cwd: args.cwd,
      reason: args.reason,
      networkApprovalContext: args.networkApprovalContext,
      grantRoot: args.grantRoot,
      fileChanges: request.apiName === 'file_change' ? request.toolContext : undefined,
    };
    const detail = JSON.stringify(context, null, 2);
    const fileContext = isRecord(request.toolContext) ? request.toolContext : undefined;
    const changes = fileContext?.changes;
    const network = isRecord(args.networkApprovalContext) ? args.networkApprovalContext : undefined;
    // The native protocol permits absent scope fields. A short JSON object alone
    // cannot prove which command or file mutation the user would be authorizing.
    const scopeKnown =
      request.apiName === 'file_change'
        ? Array.isArray(changes) &&
          changes.length > 0 &&
          changes.every(
            (change) =>
              isRecord(change) &&
              typeof change.path === 'string' &&
              change.path.length > 0 &&
              typeof change.diffText === 'string' &&
              change.diffText.length > 0 &&
              (change.kind === 'add' ||
                change.kind === 'delete' ||
                change.kind === 'update' ||
                change.kind === 'rename'),
          )
        : (typeof args.command === 'string' &&
            args.command.trim().length > 0 &&
            typeof args.cwd === 'string' &&
            args.cwd.length > 0) ||
          (typeof network?.host === 'string' &&
            network.host.length > 0 &&
            typeof network.protocol === 'string' &&
            network.protocol.length > 0);
    const complete = detail.length <= 4000 && scopeKnown;
    const options = decisions.flatMap((decision, index) => {
      const description =
        typeof decision === 'object'
          ? 'acceptWithExecpolicyAmendment' in decision
            ? `Command prefix argv: ${JSON.stringify(decision.acceptWithExecpolicyAmendment.execpolicy_amendment)}`
            : `Network policy: ${JSON.stringify(decision.applyNetworkPolicyAmendment.network_policy_amendment)}`
          : decision === 'acceptForSession'
            ? request.apiName === 'file_change'
              ? `Allow file changes for this session. Grant root: ${JSON.stringify(args.grantRoot ?? null)}`
              : `Allow this native permission for the current session. Network scope: ${JSON.stringify(args.networkApprovalContext ?? null)}`
            : undefined;
      // Review and chat share a sealed authorization list. Never offer a grant
      // whose complete scope exceeds the durable renderer's validated bounds.
      if (
        (!complete || (description && description.length > 1000)) &&
        decision !== 'decline' &&
        decision !== 'cancel'
      )
        return [];
      return [
        {
          id: `decision_${index}`,
          label:
            typeof decision === 'string'
              ? {
                  accept: 'Allow once',
                  acceptForSession: 'Allow for this session',
                  cancel: 'Stop this turn',
                  decline: 'Deny',
                }[decision]
              : 'acceptWithExecpolicyAmendment' in decision
                ? 'Allow matching commands'
                : 'Apply network rule',
          ...(description ? { description } : {}),
        },
      ];
    });
    // Cancel is always a valid bridge-level teardown action, even when the
    // native request advertises only grants; its explicit ID is not an index.
    if (!options.length) options.push({ id: 'cancel_turn', label: 'Stop this turn' });
    return {
      questions: [
        {
          header: 'Codex native permission',
          multiSelect: false,
          options,
          question: complete
            ? detail
            : 'The complete permission scope cannot be displayed safely. This request can only be denied or stopped. Full context remains in the conversation.',
        },
      ],
    };
  }

  /** Consumes only the active callback and a decision advertised for that request. */
  resolve(
    interventionId: string,
    decision: CodexApprovalDecision,
    response?: Pick<
      AgentInterventionResponseData,
      'cancelled' | 'cancelReason' | 'resolutionRequestId'
    >,
  ): boolean {
    const entry = this.pending.get(interventionId);
    if (!entry || this.queues.get(entry.request.toolCallId)?.[0] !== entry) return false;
    const args = isRecord(entry.request.arguments) ? entry.request.arguments : {};
    const allowed = Array.isArray(args.availableDecisions) ? args.availableDecisions : undefined;
    const decisions = getCodexApprovalDecisions(entry.request.apiName, args);
    const decisionIndex = decisions.findIndex((candidate) =>
      matchesApprovalDecision(candidate, decision),
    );
    const reviewed = this.reviewArguments(entry.request, decisions).questions[0].options;
    if (
      decision !== 'cancel' &&
      !reviewed.some((option) => option.id === `decision_${decisionIndex}`)
    )
      return false;
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
    void this.finish(entry, decision, response && { ...response, result: { decision } });
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
    response?: Pick<
      AgentInterventionResponseData,
      'cancelReason' | 'cancelled' | 'resolutionRequestId' | 'result'
    >,
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
    response: Pick<
      AgentInterventionResponseData,
      'cancelReason' | 'cancelled' | 'resolutionRequestId' | 'result'
    >,
  ): Promise<void> {
    return Promise.resolve(
      this.options.emit({
        data: {
          ...response,
          producerAck: true,
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
