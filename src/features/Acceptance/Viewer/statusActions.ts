import type { AcceptanceStatus, AcceptanceSubjectType } from '@lobechat/types';

export type AcceptanceStatusAction = 'accept' | 'close' | 'reopen';

export const getAcceptanceStatusActions = (
  status: AcceptanceStatus,
  subjectType?: AcceptanceSubjectType | string,
): AcceptanceStatusAction[] => {
  // A Goal release gate is settled only by its own decision — releasing the
  // wave or sending the plan back. Marking it accepted or closed would leave
  // the batch held on a report nobody can answer any more.
  if (subjectType === 'goal_gate') return [];
  const actions: AcceptanceStatusAction[] = [];

  if (status === 'delivered' || status === 'errored') actions.push('accept');
  if (status === 'accepted' || status === 'closed' || status === 'rejected') {
    actions.push('reopen');
  }
  if (status !== 'closed') actions.push('close');

  return actions;
};
