import { isRecord } from '@lobechat/utils/object';

type ExecPolicyAmendmentDecision = {
  acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] };
};

type NetworkPolicyAmendmentDecision = {
  applyNetworkPolicyAmendment: {
    network_policy_amendment: { action: 'allow' | 'deny'; host: string };
  };
};

export type CodexApprovalDecision =
  | 'accept'
  | 'acceptForSession'
  | 'cancel'
  | 'decline'
  | ExecPolicyAmendmentDecision
  | NetworkPolicyAmendmentDecision;

export interface CodexApprovalArguments {
  availableDecisions?: unknown;
  networkApprovalContext?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown;
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

export const isCodexApprovalDecision = (decision: unknown): decision is CodexApprovalDecision =>
  decision === 'accept' ||
  decision === 'acceptForSession' ||
  decision === 'cancel' ||
  decision === 'decline' ||
  isExecPolicyAmendmentDecision(decision) ||
  isNetworkPolicyAmendmentDecision(decision);

export const getCodexApprovalDecisionType = (decision: CodexApprovalDecision) => {
  if (typeof decision === 'string') return decision;
  return 'acceptWithExecpolicyAmendment' in decision
    ? 'acceptWithExecpolicyAmendment'
    : 'applyNetworkPolicyAmendment';
};

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
