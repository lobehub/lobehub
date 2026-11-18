import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { ActionIcon, copyToClipboard, DropdownMenu, toast } from '@lobehub/ui';
import { EllipsisIcon } from 'lucide-react';
import { type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { TopicPullRequestView } from '@/features/TopicPullRequests/pullRequestView';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import {
  buildPullRequestMenuItems,
  type PullRequestMenuTranslate,
  resolveAutoFixAvailability,
} from './pullRequestMenuItems';
import { useAutoFixToggle } from './useAutoFixToggle';

// The menu sits inside a clickable row, and React bubbles portal events
// through the component tree: without this, picking an item opens the PR too.
const stopRowClick = (event: MouseEvent) => event.stopPropagation();

interface PullRequestRowMenuProps {
  /** Remove the PR from this topic; the caller reports the outcome. */
  onDismiss?: () => void;
  /** The conversation the row is shown in. */
  topicId?: string | null;
  view: TopicPullRequestView;
}

/** Better Coding Experience: the "⋯" menu at the end of a topic's PR row. */
const PullRequestRowMenu = ({ onDismiss, topicId, view }: PullRequestRowMenuProps) => {
  const { t } = useTranslation('chat');
  const router = useQueryRoute();
  const availability = resolveAutoFixAvailability(view.autoFix, topicId);
  const name = `#${view.number}`;
  const autoFix = useAutoFixToggle({
    changeRequestId: availability.kind === 'own' ? availability.changeRequestId : undefined,
    onFailed: (enabled) =>
      toast.error(
        t(
          enabled
            ? 'workingPanel.overview.pr.autoFix.enableFailed'
            : 'workingPanel.overview.pr.autoFix.disableFailed',
          { name },
        ),
      ),
    topicId,
  });

  const items = buildPullRequestMenuItems({
    autoFixChecked: autoFix.pending,
    availability,
    onCopyLink: async () => {
      await copyToClipboard(view.url);
      toast.success(t('workingPanel.pr.menu.copied'));
    },
    onDismiss,
    onOpenOnGithub: () => openTrustedExternalUrl(view.url),
    onOpenOwnerTopic: (topic) => {
      if (topic.agentId) router.push(AGENT_CHAT_TOPIC_URL(topic.agentId, topic.id));
    },
    onToggleAutoFix: (enabled) => void autoFix.toggle(enabled),
    t: t as unknown as PullRequestMenuTranslate,
  });

  return (
    <DropdownMenu items={items} placement={'bottomRight'} popupProps={{ onClick: stopRowClick }}>
      <ActionIcon
        aria-label={t('workingPanel.overview.pr.menu')}
        icon={EllipsisIcon}
        size={'small'}
        title={t('workingPanel.overview.pr.menu')}
        onClick={stopRowClick}
      />
    </DropdownMenu>
  );
};

export default PullRequestRowMenu;
