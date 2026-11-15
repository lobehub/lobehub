import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelDetail } from '@lobechat/types';
import { ActionIcon, Button, DropdownMenu, Flexbox, Popover, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import {
  Bot,
  CircleUserRound,
  FolderCog,
  MoreHorizontal,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCloseOnNavigate } from '@/hooks/useCloseOnNavigate';
import { sx } from '@/styles/sx';

import { openChannelAgentEnvironment } from './AgentEnvironment';
import { canInviteMembers } from './channelAccess';
import { openInviteMembers } from './CreateChannel';
import { FailureIndicator } from './FailureIndicator';
import { MemberList, StatusAvatar, useMemberEntries } from './MemberList';
import { statusStyles, styles } from './styles';
import { useChannelMenu } from './useChannelMenu';

/** Header avatars before the rest fold into a count; the list shows everyone. */
const MAX_VISIBLE = 5;

/**
 * Channel actions a direct conversation keeps. It is the chat with one Agent, so it cannot be
 * renamed, archived or trashed; `unarchive` only frees one that was archived earlier.
 */
const DIRECT_MENU_KEYS = new Set(['copyId', 'unarchive']);

/**
 * Members as avatars with live status dots. One click lists everyone by name, because
 * Agents often share the default avatar and a long roster would not fit the header.
 */
export function MemberStatus({
  detail,
  memberPanel,
}: {
  detail: ChannelDetail;
  memberPanel?: { id: string; open: boolean; onToggle: () => void };
}) {
  const { t } = useTranslation('channel');
  const [open, setOpen] = useState(false);
  const popoverKey = useCloseOnNavigate(open, () => setOpen(false));
  const navigate = useWorkspaceAwareNavigate();
  const { channel, members: allMembers = [] } = detail;
  const entries = useMemberEntries(detail);
  const directAgent = channel.agentId
    ? entries.find((entry) => entry.member.agentId === channel.agentId)
    : undefined;
  const channelMenu = useChannelMenu();
  const overflow = entries.length - MAX_VISIBLE;
  const title = t('membersCount', { count: entries.length });
  const direct = !!channel.agentId;
  // A direct conversation is a chat with one Agent: no roster to show, only its actions, like an
  // IM header. Its title is the Agent's name, so it cannot be renamed here.
  const directMenu = () => [
    ...(directAgent
      ? [
          {
            icon: Bot,
            key: 'openAgent',
            label: t('openAgentNamed', { name: directAgent.name }),
            onClick: () => navigate(`/agent/${channel.agentId}`),
          },
          // The member list is hidden here, so its device and directory setup lives in this menu.
          ...(directAgent.member.status === 'active' &&
          channel.canDelete &&
          channel.status !== 'archived'
            ? [
                {
                  icon: FolderCog,
                  key: 'environment',
                  label: t('environment.title'),
                  onClick: () => openChannelAgentEnvironment(channel.id, directAgent.member),
                },
              ]
            : []),
          { type: 'divider' as const },
        ]
      : []),
    // Keyed items only: the menu's own dividers separate actions a direct conversation does not have.
    ...channelMenu(channel).filter(
      (item) => 'key' in item && DIRECT_MENU_KEYS.has(String(item.key)),
    ),
  ];

  // Managing a group lives on its settings page; deleting it is not one click from the header.
  const groupMenu = () => [
    ...channelMenu(channel).filter((item) => 'key' in item && item.key === 'copyId'),
    ...(channel.canDelete
      ? [
          { type: 'divider' as const },
          {
            icon: Settings,
            key: 'settings',
            label: t('settings.title'),
            onClick: () => navigate(`${CHANNEL_URL(channel.id, null, channel.projectId)}/settings`),
          },
        ]
      : []),
  ];

  return (
    <Flexbox horizontal align="center" gap={4}>
      <FailureIndicator detail={detail} />
      {direct ? (
        memberPanel && (
          <ActionIcon
            active={memberPanel.open}
            aria-controls={memberPanel.open ? memberPanel.id : undefined}
            aria-expanded={memberPanel.open}
            aria-label={t(memberPanel.open ? 'profile.hide' : 'profile.show')}
            icon={CircleUserRound}
            size="small"
            title={t(memberPanel.open ? 'profile.hide' : 'profile.show')}
            onClick={memberPanel.onToggle}
          />
        )
      ) : memberPanel ? (
        <ActionIcon
          active={memberPanel.open}
          aria-controls={memberPanel.open ? memberPanel.id : undefined}
          aria-expanded={memberPanel.open}
          aria-label={t(memberPanel.open ? 'members.hide' : 'members.show')}
          icon={Users}
          size="small"
          title={t(memberPanel.open ? 'members.hide' : 'members.show')}
          onClick={memberPanel.onToggle}
        />
      ) : (
        <Popover
          key={popoverKey}
          open={open}
          placement="bottomRight"
          trigger="click"
          content={
            <Flexbox gap={4} {...stylex.props(statusStyles.popover, statusStyles.memberList)}>
              <Text fontSize={12} type="secondary" weight={500}>
                {title}
              </Text>
              <MemberList detail={detail} onAction={() => setOpen(false)} />
            </Flexbox>
          }
          onOpenChange={setOpen}
        >
          <Button
            aria-label={title}
            size="small"
            type="text"
            {...stylex.props(statusStyles.memberButton)}
          >
            <span {...stylex.props(statusStyles.memberStack)}>
              {entries.slice(0, MAX_VISIBLE).map((entry, index) => (
                // Earlier avatars sit on top, or each one would cover the previous status dot.
                <span
                  key={entry.member.id}
                  {...sx(statusStyles.memberStackItem, { zIndex: MAX_VISIBLE - index })}
                >
                  <StatusAvatar entry={entry} size={20} />
                </span>
              ))}
            </span>
            {overflow > 0 && <span {...stylex.props(styles.muted)}>+{overflow}</span>}
          </Button>
        </Popover>
      )}
      {canInviteMembers(channel) && (
        <ActionIcon
          aria-label={t('invite.title')}
          icon={UserPlus}
          size="small"
          title={t('invite.title')}
          onClick={() =>
            openInviteMembers(
              {
                agentIds: allMembers.flatMap((member) =>
                  member.status === 'active' && member.agentId ? [member.agentId] : [],
                ),
                directAgentName: channel.agentId ? (directAgent?.name ?? '') : undefined,
                id: channel.id,
                workspaceId: channel.workspaceId,
              },
              // Inviting from a direct conversation opens the group it starts.
              (id) => navigate(CHANNEL_URL(id)),
            )
          }
        />
      )}
      <DropdownMenu items={direct ? directMenu() : groupMenu()}>
        <ActionIcon
          aria-label={t('more', { ns: 'common' })}
          icon={MoreHorizontal}
          size="small"
          title={t('more', { ns: 'common' })}
        />
      </DropdownMenu>
    </Flexbox>
  );
}
