import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { ActionIcon, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { TriangleAlertIcon, XIcon } from 'lucide-react';
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
  /** Better Coding Experience: remove the PR from the topic's lists. */
  onDismiss?: () => void;
  pullRequest: DeviceGitLinkedPullRequest;
  /** Defaults to `#number title`. */
  tooltip?: string;
  /** The app cannot vouch the PR belongs to the topic (its merge / close are locked). */
  unvouched?: boolean;
}

/** One pull request under the repository card's Changes row: state, number, title, CI. */
const PullRequestRow = memo<PullRequestRowProps>(
  ({ onClick, onDismiss, pullRequest, tooltip, unvouched }) => {
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
              <>
                {unvouched && (
                  <Tooltip title={t('workingPanel.overview.pr.unvouched')}>
                    <Icon
                      aria-label={t('workingPanel.overview.pr.unvouched')}
                      color={cssVar.colorWarning}
                      icon={TriangleAlertIcon}
                      size={13}
                    />
                  </Tooltip>
                )}
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
                {onDismiss && (
                  <ActionIcon
                    aria-label={t('workingPanel.overview.pr.dismiss')}
                    icon={XIcon}
                    size={'small'}
                    title={t('workingPanel.overview.pr.dismiss')}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDismiss();
                    }}
                  />
                )}
              </>
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
  },
);

PullRequestRow.displayName = 'OverviewPullRequestRow';

export default PullRequestRow;
