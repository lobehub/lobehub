import type { CodexApprovalDecision } from '@lobechat/types';
import { isCodexApprovalDecision } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

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

  // Decline rejects this operation; cancel aborts the native turn.
  if (apiName === 'file_change') return ['accept', 'acceptForSession', 'decline'];

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
  decisions.push('decline');
  return decisions;
};
