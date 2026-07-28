import type { AcceptanceStatus } from '@lobechat/types';

export type AcceptanceStatusAction = 'accept' | 'close' | 'reopen';

export const getAcceptanceStatusActions = (status: AcceptanceStatus): AcceptanceStatusAction[] => {
  const actions: AcceptanceStatusAction[] = [];

  if (status === 'delivered' || status === 'errored') actions.push('accept');
  if (status === 'accepted' || status === 'closed' || status === 'rejected') {
    actions.push('reopen');
  }
  if (status !== 'closed') actions.push('close');

  return actions;
};
