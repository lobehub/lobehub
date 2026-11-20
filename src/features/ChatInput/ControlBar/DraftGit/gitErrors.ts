import type { DeviceGitSyncResult } from '@lobechat/types';
import { DEVICE_GIT_OUTDATED } from '@lobechat/types';
import type { TFunction } from 'i18next';

import { getPathName } from '../worktreeHelpers';

/**
 * The user-facing reason for a failed git write. Refusals the device reports
 * as a reason code (an outdated device, a branch held by another worktree, no
 * upstream) are said in the user's language; anything else is git's own text.
 */
export const describeGitFailure = (
  result: Pick<DeviceGitSyncResult, 'branch' | 'error' | 'reason' | 'worktreePath'>,
  t: TFunction<'device'>,
  fallback: string,
): string => {
  switch (result.reason) {
    case DEVICE_GIT_OUTDATED: {
      return t('workingDirectory.deviceOutdated');
    }
    case 'checkedOutElsewhere': {
      return t('workingDirectory.pullCheckedOutElsewhere', {
        branch: result.branch ?? '',
        name: result.worktreePath ? getPathName(result.worktreePath) : '',
      });
    }
    case 'noUpstream': {
      return t('workingDirectory.pullNoUpstream', { branch: result.branch ?? '' });
    }
    default: {
      return result.error || fallback;
    }
  }
};
