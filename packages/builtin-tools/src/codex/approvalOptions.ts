import { isRecord } from '@lobechat/utils/object';

type ExecPolicyAmendmentDecision = {
  acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] };
};

type NetworkPolicyAmendmentDecision = {
  applyNetworkPolicyAmendment: {
    network_policy_amendment: { action: 'allow' | 'deny'; host: string };
  };
};

/** A native command or file-change approval decision. */
export type CodexApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'cancel'
  | 'decline'
  | ExecPolicyAmendmentDecision
  | NetworkPolicyAmendmentDecision;

/** Native request context shown before authorizing a command or file change. */
export interface CodexApprovalArguments {
  availableDecisions?: unknown;
  /** Command awaiting approval, preserving the exact native text. */
  command?: string | null;
  /** Working directory in which the command will run. */
  cwd?: string | null;
  /** Directory whose write scope would be granted for this session. */
  grantRoot?: string | null;
  networkApprovalContext?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown;
  /** Native explanation for requesting expanded permission. */
  reason?: string | null;
}

const isExecPolicyAmendmentDecision = (
  decision: unknown,
): decision is ExecPolicyAmendmentDecision => {
  if (!isRecord(decision)) return false;
  const amendment = decision.acceptWithExecpolicyAmendment;
  return (
    isRecord(amendment) &&
    Array.isArray(amendment.execpolicy_amendment) &&
    amendment.execpolicy_amendment.every((part) => typeof part === 'string')
  );
};

const isNetworkPolicyAmendmentDecision = (
  decision: unknown,
): decision is NetworkPolicyAmendmentDecision => {
  if (!isRecord(decision)) return false;
  const amendment = decision.applyNetworkPolicyAmendment;
  if (!isRecord(amendment) || !isRecord(amendment.network_policy_amendment)) return false;
  const policy = amendment.network_policy_amendment;
  return typeof policy.host === 'string' && (policy.action === 'allow' || policy.action === 'deny');
};

/**
 * Checks whether native input contains a supported decision.
 *
 * Use when:
 * - Reading advertised approval choices.
 *
 * Expects:
 * - An untrusted native payload.
 *
 * Returns:
 * - Whether the decision has a recognized, complete shape.
 */
export const isCodexApprovalDecision = (decision: unknown): decision is CodexApprovalDecision =>
  decision === 'accept' ||
  decision === 'acceptForSession' ||
  decision === 'cancel' ||
  decision === 'decline' ||
  isExecPolicyAmendmentDecision(decision) ||
  isNetworkPolicyAmendmentDecision(decision);

/**
 * Identifies the native decision variant for presentation.
 *
 * Use when:
 * - Selecting a label for a validated decision.
 *
 * Expects:
 * - A supported native decision.
 *
 * Returns:
 * - Its string variant name.
 */
export const getCodexApprovalDecisionType = (decision: CodexApprovalDecision) => {
  if (typeof decision === 'string') return decision;
  return 'acceptWithExecpolicyAmendment' in decision
    ? 'acceptWithExecpolicyAmendment'
    : 'applyNetworkPolicyAmendment';
};

/**
 * Lists choices advertised by the native approval request.
 *
 * Use when:
 * - Rendering command or file-change approval actions.
 *
 * Expects:
 * - The native request context and tool API name.
 *
 * Returns:
 * - Advertised decisions, or compatible choices derived from native proposals.
 */
export const getCodexApprovalDecisions = (
  apiName: string | undefined,
  args: CodexApprovalArguments,
): CodexApprovalDecision[] => {
  if (Array.isArray(args.availableDecisions)) {
    return args.availableDecisions.filter(isCodexApprovalDecision);
  }

  if (apiName === 'file_change') return ['accept', 'acceptForSession', 'cancel'];

  const decisions: CodexApprovalDecision[] = ['accept'];
  if (isRecord(args.networkApprovalContext)) {
    decisions.push('acceptForSession');
    if (Array.isArray(args.proposedNetworkPolicyAmendments)) {
      const policy = args.proposedNetworkPolicyAmendments.find(
        (amendment) => isRecord(amendment) && amendment.action === 'allow',
      );
      if (isRecord(policy) && typeof policy.host === 'string') {
        decisions.push({
          applyNetworkPolicyAmendment: {
            network_policy_amendment: { action: 'allow', host: policy.host },
          },
        });
      }
    }
  } else if (
    Array.isArray(args.proposedExecpolicyAmendment) &&
    args.proposedExecpolicyAmendment.every((part) => typeof part === 'string')
  ) {
    decisions.push({
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: args.proposedExecpolicyAmendment,
      },
    });
  }
  decisions.push('cancel');
  return decisions;
};
