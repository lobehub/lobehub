import type { TaskAutomationPauseCause } from '@lobechat/types';
import type { ReactNode } from 'react';

/**
 * Lets a deployment offer a way out next to the notice of a scheduled task the failure fuse
 * paused for a cause only the account owner can clear, such as an upgrade entry. Returns
 * nothing by default: the notice text already names the remedies.
 */
export const useBusinessTaskPauseAction = (
  _cause: TaskAutomationPauseCause,
  _workspaceId?: string | null,
): ReactNode => undefined;
