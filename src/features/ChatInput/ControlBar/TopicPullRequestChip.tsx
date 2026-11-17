import { DropdownMenu, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GitPullRequest, TriangleAlertIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getPullRequestState,
  PR_STATE_VISUAL,
} from '@/features/AgentSidebar/Topic/List/Item/metaCardData';
import TopicPullRequestProbes from '@/features/TopicPullRequests/TopicPullRequestProbes';
import { useTopicPullRequests } from '@/features/TopicPullRequests/useTopicPullRequests';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import { gitChipStyles } from './gitChipStyles';

const styles = stylex.create({
  extra: { color: 'inherit', fontVariantNumeric: 'tabular-nums', opacity: 0.65 },
});

interface TopicPullRequestChipProps {
  deviceId?: string;
  path: string;
  topicId: string;
}

/**
 * Better Coding Experience: the pull requests the agent's own commands linked
 * to this topic. Shows the latest one still open (else the latest), plus how
 * many more; with more than one, a click lists them all. Nothing renders until
 * a PR is linked.
 */
const TopicPullRequestChip = memo<TopicPullRequestChipProps>(({ deviceId, path, topicId }) => {
  const { t } = useTranslation('device');
  const { t: tChat } = useTranslation('chat');
  const { primary, probes, views } = useTopicPullRequests({ deviceId, path, topicId });
  const extra = views.length - 1;

  const items = useMemo(
    () =>
      views.map((view) => {
        const visual = PR_STATE_VISUAL[getPullRequestState(view)];
        return {
          // How the PR was linked is kept, not shown; only a PR the app cannot
          // vouch for is flagged, since its merge / close stay locked.
          extra: view.vouched ? undefined : (
            <Icon
              aria-label={tChat('workingPanel.overview.pr.unvouched')}
              color={cssVar.colorWarning}
              icon={TriangleAlertIcon}
              size={12}
            />
          ),
          icon: <Icon color={visual.color} icon={visual.icon} size={14} />,
          key: view.identifier,
          label: `#${view.number} ${view.title}`,
          onClick: () => openTrustedExternalUrl(view.url),
        };
      }),
    [tChat, views],
  );

  const probeReads = <TopicPullRequestProbes deviceId={deviceId} path={path} probes={probes} />;
  if (!primary) return probeReads;

  const chip = (
    <div
      {...stylex.props(gitChipStyles.prTrigger)}
      data-testid="topic-pull-request-chip"
      role="button"
      onClick={extra > 0 ? undefined : () => openTrustedExternalUrl(primary.url)}
    >
      <Icon icon={GitPullRequest} size={12} />
      <span>#{primary.number}</span>
      {extra > 0 && <span {...stylex.props(styles.extra)}>+{extra}</span>}
    </div>
  );

  return (
    <>
      {probeReads}
      <div {...stylex.props(gitChipStyles.separator)} />
      {extra > 0 ? (
        <DropdownMenu items={items} placement="topLeft">
          <div>
            <Tooltip
              title={t('workingDirectory.topicPullRequestsTooltip', {
                count: extra,
                title: primary.title,
              })}
            >
              {chip}
            </Tooltip>
          </div>
        </DropdownMenu>
      ) : (
        <Tooltip title={primary.title}>{chip}</Tooltip>
      )}
    </>
  );
});

TopicPullRequestChip.displayName = 'TopicPullRequestChip';

export default TopicPullRequestChip;
