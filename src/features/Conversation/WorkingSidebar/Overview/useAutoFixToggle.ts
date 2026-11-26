import { useState } from 'react';

import { mutate } from '@/libs/swr';
import { scmKeys } from '@/libs/swr/keys';
import { scmService } from '@/services/scm';
import { workService } from '@/services/work';

/**
 * Switch a pull request's Auto-fix from the conversation it wakes. The new
 * state shows at once and holds until the refreshed list carries it (with
 * the reset count); a save that fails puts it back and calls `onFailed`.
 */
export const useAutoFixToggle = (params: {
  changeRequestId?: string;
  onFailed: (enabled: boolean) => void;
  topicId?: string | null;
}) => {
  const { changeRequestId, onFailed, topicId } = params;
  const [pending, setPending] = useState<boolean>();

  const toggle = async (enabled: boolean) => {
    if (!changeRequestId) return;
    setPending(enabled);
    try {
      await scmService.setChangeRequestAutoFix({ changeRequestId, enabled });
    } catch {
      setPending(undefined);
      onFailed(enabled);
      return;
    }
    try {
      await Promise.all([
        workService.refreshTopicPullRequests(topicId),
        // An idle open conversation polls for server-started runs only while
        // something can still wake it; turning Auto-fix on (or off) changes that.
        topicId ? mutate(scmKeys.wakeTarget(topicId)) : undefined,
      ]);
    } finally {
      setPending(undefined);
    }
  };

  return { pending, toggle };
};
