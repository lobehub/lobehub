import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { Icon, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getCiVisual,
  getPullRequestState,
  PR_STATE_VISUAL,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';

import { shouldShowCiLabel } from './overviewData';
import { OverviewRow, rowStyles } from './OverviewRow';
import { sectionStyles } from './sectionStyles';

interface PullRequestRowProps {
  onClick: () => void;
  pullRequest: DeviceGitLinkedPullRequest;
  /** Defaults to `#number title`. */
  tooltip?: string;
}

/** One pull request under the repository card's Changes row: state, number, title, CI. */
const PullRequestRow = memo<PullRequestRowProps>(({ onClick, pullRequest, tooltip }) => {
  const { t } = useTranslation('chat');
  const ciStatus = pullRequest.ciStatus;
  const ci = getCiVisual(ciStatus);
  const prVisual = PR_STATE_VISUAL[getPullRequestState(pullRequest)];

  return (
    <Tooltip title={tooltip ?? `#${pullRequest.number} ${pullRequest.title}`}>
      <div>
        <OverviewRow
          icon={prVisual.icon}
          iconColor={prVisual.color}
          trailing={
            <span
              className={sectionStyles.pill}
              style={{ background: `color-mix(in srgb,  12%, transparent)`, color: ci.color }}
            >
              <Icon icon={ci.icon} size={12} />
              {shouldShowCiLabel(ciStatus)
                ? t(
                    `workingPanel.overview.ci.${ciStatus as 'failure' | 'pending'}` as 'workingPanel.overview.ci.failure',
                  )
                : null}
            </span>
          }
          value={
            <>
              <span className={rowStyles.num}>#{pullRequest.number}</span>
              {pullRequest.title}
            </>
          }
          onClick={onClick}
        />
      </div>
    </Tooltip>
  );
});

PullRequestRow.displayName = 'OverviewPullRequestRow';

export default PullRequestRow;
