// Extracted from `codex app-server generate-ts` at
// CODEX_APP_SERVER_APPROVAL_PROTOCOL_REVISION. Keep wire names and nullability exact.

import type {
  CommandExecutionRequestApprovalParams,
  ExecPolicyAmendment,
  NetworkPolicyAmendment,
} from './generated';

export type CommandExecutionApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: ExecPolicyAmendment } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: NetworkPolicyAmendment } }
  | 'decline'
  | 'cancel';

export type CodexCommandExecutionRequestApprovalParams = CommandExecutionRequestApprovalParams & {
  /** Ordered list of decisions the client may present for this prompt. */
  availableDecisions?: CommandExecutionApprovalDecision[] | null;
};

export type CommandExecutionRequestApprovalResponse = {
  decision: CommandExecutionApprovalDecision;
};

export type FileChangeApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export type FileChangeRequestApprovalResponse = {
  decision: FileChangeApprovalDecision;
};
