import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import { ActionIcon, copyToClipboard, DropdownMenu, toast } from '@lobehub/ui';
import { EllipsisIcon } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TopicPullRequestView } from '@/features/TopicPullRequests/pullRequestView';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { scmService } from '@/services/scm';
import { workService } from '@/services/work';
import { openTrustedExternalUrl } from '@/utils/openTrustedExternalUrl';

import {
  buildPullRequestMenuItems,
  type PullRequestMenuTranslate,
  resolveAutoFixAvailability,
} from './pullRequestMenuItems';

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
  // Ahead of the refreshed list, so the check mark follows the click at once.
  const [pendingAutoFix, setPendingAutoFix] = useState<boolean>();
  const availability = resolveAutoFixAvailability(view.autoFix, topicId);
  const name = `#${view.number}`;

  const toggleAutoFix = async (enabled: boolean) => {
    if (availability.kind !== 'own') return;
    setPendingAutoFix(enabled);
    try {
      await scmService.setChangeRequestAutoFix({
        changeRequestId: availability.changeRequestId,
        enabled,
      });
    } catch {
      // Not saved: the check mark goes back, and the person is told.
      setPendingAutoFix(undefined);
      toast.error(
        t(
          enabled
            ? 'workingPanel.overview.pr.autoFix.enableFailed'
            : 'workingPanel.overview.pr.autoFix.disableFailed',
          { name },
        ),
      );
      return;
    }
    // Saved: hold the new state until the list carries it (and the reset count).
    try {
      await workService.refreshTopicPullRequests(topicId);
    } finally {
      setPendingAutoFix(undefined);
    }
  };

  const items = buildPullRequestMenuItems({
    autoFixChecked: pendingAutoFix,
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
    onToggleAutoFix: (enabled) => void toggleAutoFix(enabled),
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
