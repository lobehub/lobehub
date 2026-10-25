export type ApprovalChoice = 'approve' | 'approve-remember' | 'reject';

/**
 * Whether submitting `choice` must wait. Approving is held while the
 * intervention reports it cannot show what is being approved
 * (`approveDisabled`); rejecting is always allowed, so the user is never stuck.
 */
export const isChoiceSubmitBlocked = (choice: ApprovalChoice, approveDisabled = false) =>
  approveDisabled && choice !== 'reject';

/**
 * The choices an approval card lists, in order. "Approve and remember" is
 * offered when the user's allow-list can take the tool, or when the tool's
 * own intervention offers a remember choice of its own.
 */
export const getApprovalChoices = ({
  allowListMode,
  toolRemember,
}: {
  allowListMode: boolean;
  toolRemember: boolean;
}): ApprovalChoice[] =>
  allowListMode || toolRemember ? ['approve', 'approve-remember', 'reject'] : ['approve', 'reject'];

/**
 * What "approve and remember" does: a tool-offered choice runs the tool's own
 * remember step (e.g. a standing grant), which also works for tools whose
 * policy an allow-list can never bypass; otherwise, in allow-list mode, the
 * tool joins the allow-list.
 */
export const resolveRememberAction = ({
  allowListMode,
  toolRemember,
}: {
  allowListMode: boolean;
  toolRemember: boolean;
}): 'allow-list' | 'none' | 'tool' => {
  if (toolRemember) return 'tool';
  return allowListMode ? 'allow-list' : 'none';
};
