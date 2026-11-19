import type { NotifyContactRequestParams } from '@/business/server/contact/notifyActivity';
import { notifyContactRequest } from '@/business/server/contact/notifyActivity';
import { notifyUsers } from '@/server/services/user/notify';
import { after } from '@/server/utils/scheduleAfterResponse';

/**
 * Tell the other person about a contact request: a new one, or theirs that was accepted. Runs
 * after the response and never fails the request; repeating a request returns the same id, so
 * its notification dedupes. The business slot is a no-op outside Cloud.
 */
export const notifyContactRequestAfterResponse = (params: NotifyContactRequestParams) => {
  after(async () => {
    try {
      await notifyContactRequest(params);
    } catch (error) {
      console.error('[contact] Failed to send contact request notification', {
        error,
        kind: params.kind,
        requestId: params.requestId,
      });
    }
  });
};

/**
 * Refresh the address book of everyone a contact change touched, on every device they have
 * open: the badge for a new request, a request that was answered or withdrawn, a contact added
 * or removed. Include the actor, whose other devices are stale too. Runs after the response.
 */
export const notifyContactsChangedAfterResponse = (userIds: string[]) => {
  after(() => notifyUsers('contacts', userIds));
};
