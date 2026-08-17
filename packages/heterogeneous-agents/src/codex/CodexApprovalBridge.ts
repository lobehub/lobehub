import type {
  AgentInterventionRequestData,
  AgentInterventionResponseData,
  AgentStreamEvent,
} from '@lobechat/agent-gateway-client';

import type { CommandExecutionApprovalDecision, FileChangeApprovalDecision } from './protocol';

const DEFAULT_CODEX_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type CodexApprovalDecision = Extract<
  CommandExecutionApprovalDecision & FileChangeApprovalDecision,
  string
>;

interface ApprovalRequest {
  apiName: 'command_execution' | 'file_change';
  arguments: unknown;
  interventionId: string;
  toolCallId: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: CodexApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface CodexApprovalBridgeOptions {
  emit: (event: AgentStreamEvent) => Promise<void> | void;
  operationId: string;
  timeoutMs?: number;
}

/** Per-turn bridge from Codex server requests to LobeHub intervention events. */
export class CodexApprovalBridge {
  private closed = false;
  private readonly pending = new Map<string, PendingApproval[]>();

  constructor(private readonly options: CodexApprovalBridgeOptions) {}

  async request(request: ApprovalRequest): Promise<CodexApprovalDecision> {
    if (this.closed) return 'cancel';

    const timeoutMs = this.options.timeoutMs ?? DEFAULT_CODEX_APPROVAL_TIMEOUT_MS;
    const timestamp = Date.now();
    let pendingEntry!: PendingApproval;
    const decision = new Promise<CodexApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.remove(request.interventionId, pendingEntry);
        this.emitResponse(request, { cancelReason: 'timeout', cancelled: true });
        resolve('cancel');
      }, timeoutMs);
      timer.unref?.();
      pendingEntry = { request, resolve, timer };
      const queue = this.pending.get(request.interventionId) ?? [];
      queue.push(pendingEntry);
      this.pending.set(request.interventionId, queue);
    });

    const data: AgentInterventionRequestData = {
      apiName: request.apiName,
      arguments: JSON.stringify(request.arguments ?? {}),
      deadline: timestamp + timeoutMs,
      identifier: 'codex',
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
      this.remove(request.interventionId, pendingEntry);
      clearTimeout(pendingEntry.timer);
      pendingEntry.resolve('cancel');
    }

    return decision;
  }

  resolve(interventionId: string, decision: CodexApprovalDecision): boolean {
    const queue = this.pending.get(interventionId);
    const entry = queue?.shift();
    if (!entry) return false;
    if (queue?.length === 0) this.pending.delete(interventionId);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    return true;
  }

  cancelAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const queue of this.pending.values()) {
      for (const entry of queue) {
        clearTimeout(entry.timer);
        this.emitResponse(entry.request, { cancelReason: 'session_ended', cancelled: true });
        entry.resolve('cancel');
      }
    }
    this.pending.clear();
  }

  private emitResponse(
    request: ApprovalRequest,
    response: Pick<AgentInterventionResponseData, 'cancelReason' | 'cancelled'>,
  ): void {
    void Promise.resolve(
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

  private remove(interventionId: string, entry: PendingApproval): void {
    const queue = this.pending.get(interventionId);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.pending.delete(interventionId);
  }
}
