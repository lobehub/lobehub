import type { DeviceGitLinkedPullRequest } from '@lobechat/types';
import { ActionIcon, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  // In the trailing slot, so a long title truncates before the tag does.
  source: {
    flexShrink: 0,
    paddingInline: '5px',
    borderRadius: '4px',
    fontSize: '11px',
    lineHeight: '16px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface PullRequestRowProps {
  onClick: () => void;
  /** Better Coding Experience: remove the PR from the topic's lists. */
  onDismiss?: () => void;
  pullRequest: DeviceGitLinkedPullRequest;
  /** The full sentence behind {@link sourceLabel}, shown on hover. */
  sourceDescription?: string;
  /** How the topic came to it, when it was not the agent opening it: a short tag. */
  sourceLabel?: string;
  /** Defaults to `#number title`. */
  tooltip?: string;
  /** The app cannot vouch the PR belongs to the topic (its merge / close are locked). */
  unvouched?: boolean;
}

/** One pull request under the repository card's Changes row: state, number, title, CI. */
const PullRequestRow = memo<PullRequestRowProps>(
  ({ onClick, onDismiss, pullRequest, sourceDescription, sourceLabel, tooltip, unvouched }) => {
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
                {sourceLabel && (
                  <Tooltip title={sourceDescription}>
                    <span {...stylex.props(styles.source)}>{sourceLabel}</span>
                  </Tooltip>
                )}
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
