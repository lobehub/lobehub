import { DEFAULT_SECURITY_BLACKLIST, InterventionChecker } from '@lobechat/agent-runtime';
import type { HumanInterventionConfig } from '@lobechat/types';

export type ApprovalChoice = 'approve' | 'approve-remember' | 'reject';

/**
 * Whether submitting `choice` must wait. Approving is held while the
 * intervention reports it cannot show what is being approved
 * (`approveDisabled`); rejecting is always allowed, so the user is never stuck.
 */
export const isChoiceSubmitBlocked = (choice: ApprovalChoice, approveDisabled = false) =>
  approveDisabled && choice !== 'reject';

/**
 * Whether "approve, and don't ask again" can take effect for a call through
 * the allow-list (the generic remember step): the runtime skips approval for
 * allow-listed tools in manual and allow-list modes, but never for calls
 * that must always ask — an `always` policy, static or dynamic, or a
 * security-blacklist match.
 */
export const canRememberViaAllowList = ({
  config,
  toolArgs = {},
}: {
  config?: unknown;
  toolArgs?: Record<string, unknown>;
}) => {
  if (InterventionChecker.checkSecurityBlacklist(DEFAULT_SECURITY_BLACKLIST, toolArgs).blocked) {
    return false;
  }
  if (config && typeof config === 'object' && !Array.isArray(config) && 'dynamic' in config) {
    const dynamic = (config as { dynamic?: { policy?: string } }).dynamic;
    return dynamic?.policy !== 'always';
  }
  return (
    InterventionChecker.shouldIntervene({
      config: config as HumanInterventionConfig | undefined,
      securityBlacklist: [],
      toolArgs,
    }) !== 'always'
  );
};

/**
 * The choices an approval card lists, in order. "Approve, and don't ask again
 * for similar actions" is one shared choice for every tool: offered when the
 * tool defines its own notion of "similar" (a remember step of its own), or
 * when the allow-list can remember the tool in the current mode.
 */
export const getApprovalChoices = ({
  allowListRememberable,
  approvalMode,
  toolRemember,
}: {
  allowListRememberable: boolean;
  approvalMode: string;
  toolRemember: boolean;
}): ApprovalChoice[] => {
  const viaAllowList =
    allowListRememberable && (approvalMode === 'manual' || approvalMode === 'allow-list');
  return toolRemember || viaAllowList
    ? ['approve', 'approve-remember', 'reject']
    : ['approve', 'reject'];
};

/**
 * What "approve and don't ask again" does: a tool's own remember step (e.g.
 * a standing grant scoped to the same access) when it offers one, otherwise
 * the tool joins the allow-list.
 */
export const resolveRememberAction = ({
  toolRemember,
}: {
  toolRemember: boolean;
}): 'allow-list' | 'tool' => (toolRemember ? 'tool' : 'allow-list');
