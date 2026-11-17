import type { TopicPullRequestAutoFix } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import { ExternalLinkIcon, LinkIcon, MessageSquareShareIcon, XIcon } from 'lucide-react';

type OwnerTopic = NonNullable<TopicPullRequestAutoFix['ownerTopic']>;

/**
 * What the PR row can do with Auto-fix, from the GitHub App's view of the PR
 * and the conversation the row sits in. Auto-fix wakes exactly one
 * conversation, so only that conversation may switch it.
 */
export type AutoFixAvailability =
  /** No GitHub App installation tracks the repository: nothing would wake anyone. */
  | { kind: 'noApp' }
  /** Tracked, but no conversation is linked for it to wake. */
  | { kind: 'unlinked' }
  /** It wakes another conversation — named when the viewer can open it. */
  | { kind: 'otherTopic'; ownerTopic: OwnerTopic | null }
  | {
      changeRequestId: string;
      enabled: boolean;
      kind: 'own';
      maxWakes: number;
      wakeCount: number;
    };

export const resolveAutoFixAvailability = (
  autoFix: TopicPullRequestAutoFix | undefined,
  topicId: string | null | undefined,
): AutoFixAvailability => {
  if (!autoFix) return { kind: 'noApp' };
  if (!autoFix.ownerTopicId) return { kind: 'unlinked' };
  if (autoFix.ownerTopicId !== topicId) {
    return { kind: 'otherTopic', ownerTopic: autoFix.ownerTopic };
  }
  return {
    changeRequestId: autoFix.changeRequestId,
    enabled: autoFix.enabled,
    kind: 'own',
    maxWakes: autoFix.maxWakes,
    wakeCount: autoFix.wakeCount,
  };
};

export type PullRequestMenuKey =
  | 'workingPanel.overview.pr.autoFix'
  | 'workingPanel.overview.pr.autoFix.capped'
  | 'workingPanel.overview.pr.autoFix.desc'
  | 'workingPanel.overview.pr.autoFix.noApp'
  | 'workingPanel.overview.pr.autoFix.otherTopic'
  | 'workingPanel.overview.pr.autoFix.otherTopicHidden'
  | 'workingPanel.overview.pr.autoFix.openOwner'
  | 'workingPanel.overview.pr.autoFix.resetOnEnable'
  | 'workingPanel.overview.pr.autoFix.unlinked'
  | 'workingPanel.overview.pr.autoFix.woken'
  | 'workingPanel.overview.pr.dismiss'
  | 'workingPanel.pr.menu.copyLink'
  | 'workingPanel.pr.menu.openOnGithub';

export type PullRequestMenuTranslate = (
  key: PullRequestMenuKey,
  options?: Record<string, unknown>,
) => string;

/** The line under Auto-fix: why it cannot be switched here, or how far it has got. */
export const describeAutoFix = (
  availability: AutoFixAvailability,
  t: PullRequestMenuTranslate,
): string => {
  switch (availability.kind) {
    case 'noApp': {
      return t('workingPanel.overview.pr.autoFix.noApp');
    }
    case 'unlinked': {
      return t('workingPanel.overview.pr.autoFix.unlinked');
    }
    case 'otherTopic': {
      const title = availability.ownerTopic?.title?.trim();
      return title
        ? t('workingPanel.overview.pr.autoFix.otherTopic', { title })
        : t('workingPanel.overview.pr.autoFix.otherTopicHidden');
    }
    case 'own': {
      const { enabled, maxWakes: max, wakeCount: count } = availability;
      if (count === 0) return t('workingPanel.overview.pr.autoFix.desc');
      // Turning it back on starts over; say so while that is what the switch would do.
      if (!enabled) return t('workingPanel.overview.pr.autoFix.resetOnEnable', { count, max });
      if (count >= max) return t('workingPanel.overview.pr.autoFix.capped', { count, max });
      return t('workingPanel.overview.pr.autoFix.woken', { count, max });
    }
  }
};

export interface PullRequestMenuParams {
  /** The switch as the person last set it, ahead of the server's answer. */
  autoFixChecked?: boolean;
  availability: AutoFixAvailability;
  onCopyLink: () => void;
  /** Remove the PR from this topic; absent where the row cannot be removed. */
  onDismiss?: () => void;
  onOpenOnGithub: () => void;
  onOpenOwnerTopic: (topic: OwnerTopic) => void;
  onToggleAutoFix: (enabled: boolean) => void;
  t: PullRequestMenuTranslate;
}

/**
 * The PR row's "⋯" menu: open, copy, Auto-fix, remove. Auto-fix is always
 * listed so the person learns it exists; where it cannot be switched here
 * the line under it says why — and, when it wakes another conversation the
 * viewer can open, the next item goes there.
 */
export const buildPullRequestMenuItems = ({
  availability,
  autoFixChecked,
  onCopyLink,
  onDismiss,
  onOpenOnGithub,
  onOpenOwnerTopic,
  onToggleAutoFix,
  t,
}: PullRequestMenuParams): DropdownItem[] => {
  const own = availability.kind === 'own';
  // A conversation without an agent has no address to go to.
  const ownerTopic =
    availability.kind === 'otherTopic' && availability.ownerTopic?.agentId
      ? availability.ownerTopic
      : null;

  return [
    {
      icon: ExternalLinkIcon,
      key: 'openOnGithub',
      label: t('workingPanel.pr.menu.openOnGithub'),
      onClick: onOpenOnGithub,
    },
    {
      icon: LinkIcon,
      key: 'copyLink',
      label: t('workingPanel.pr.menu.copyLink'),
      onClick: onCopyLink,
    },
    { type: 'divider' },
    {
      // A group of its own: in a list that also has icons, the menu moves a
      // checkbox's mark to the right edge; alone here it takes the leading
      // icon slot, where the other items show their icons.
      children: [
        {
          checked: own ? (autoFixChecked ?? availability.enabled) : false,
          // Stay open so the count under it visibly starts over.
          closeOnClick: false,
          desc: describeAutoFix(availability, t),
          disabled: !own,
          key: 'autoFix',
          label: t('workingPanel.overview.pr.autoFix'),
          onCheckedChange: onToggleAutoFix,
          type: 'checkbox',
        },
      ],
      key: 'autoFixGroup',
      type: 'group',
    },
    ...(ownerTopic
      ? [
          {
            icon: MessageSquareShareIcon,
            key: 'openOwnerTopic',
            label: t('workingPanel.overview.pr.autoFix.openOwner'),
            onClick: () => onOpenOwnerTopic(ownerTopic),
          },
        ]
      : []),
    ...(onDismiss
      ? [
          { type: 'divider' as const },
          {
            danger: true,
            icon: XIcon,
            key: 'dismiss',
            label: t('workingPanel.overview.pr.dismiss'),
            onClick: onDismiss,
          },
        ]
      : []),
  ];
};
