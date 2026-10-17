export type ApprovalChoice = 'approve' | 'approve-remember' | 'reject';

/**
 * Whether submitting `choice` must wait. Approving is held while the
 * intervention reports it cannot show what is being approved
 * (`approveDisabled`); rejecting is always allowed, so the user is never stuck.
 */
export const isChoiceSubmitBlocked = (choice: ApprovalChoice, approveDisabled = false) =>
  approveDisabled && choice !== 'reject';
