import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Activity, memo } from 'react';

import PullRequest from '.';
import { usePublishPrUrl } from './usePublishPrUrl';

interface PullRequestSidebarTabProps {
  active: boolean;
  /** The sidebar has room for this tab, so a Work card may open it. */
  canShow: boolean;
  className?: string;
  confirmed: boolean;
  confirmError?: unknown;
  deviceId?: string;
  onOpenTab: (tab: string) => void;
  onRetryConfirm?: () => void;
  pullRequest: DeviceGitLinkedPullRequest;
  workingDirectory: string;
}

/**
 * The Working Sidebar's PR tab. Mounted (hidden) whenever the working directory
 * has a linked PR, so it also publishes that PR for Work cards while collapsed.
 */
const PullRequestSidebarTab = memo<PullRequestSidebarTabProps>(
  ({ active, canShow, className, deviceId, pullRequest, workingDirectory, ...rest }) => {
    usePublishPrUrl(canShow ? pullRequest.url : undefined);

    return (
      <Activity mode={active ? 'visible' : 'hidden'}>
        <Flexbox className={className}>
          <PullRequest
            {...rest}
            active={active}
            deviceId={deviceId}
            key={JSON.stringify([deviceId, workingDirectory, pullRequest.number])}
            number={pullRequest.number}
            summary={pullRequest}
            url={pullRequest.url}
            workingDirectory={workingDirectory}
          />
        </Flexbox>
      </Activity>
    );
  },
);

PullRequestSidebarTab.displayName = 'PullRequestSidebarTab';

export default PullRequestSidebarTab;
