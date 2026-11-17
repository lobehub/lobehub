import type { ChannelDetail, ChannelPublicMember } from '@lobechat/types';
import type { DropdownItem } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Flexbox, Icon, Spin, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, FolderCog, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { openChannelAgentEnvironment } from './AgentEnvironment';
import { ChannelStatus } from './ChannelStatus';
import type { ChannelStatusTone } from './jobStatus';
import { channelJobTone, memberCurrentJob, memberJobStatus } from './jobStatus';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { MemberProfileTrigger } from './MemberProfileTrigger';
import { statusStyles, styles, toneStyles } from './styles';
import { getVisibleStatusMembers, groupMembersByActor } from './visibleMembers';

interface MemberEntry {
  label: string;
  member: ChannelPublicMember;
  name: string;
  tone: ChannelStatusTone;
}

export const StatusAvatar = ({ entry, size }: { entry: MemberEntry; size: number }) => (
  <span {...stylex.props(statusStyles.memberAvatar)}>
    <MemberAvatar member={entry.member} size={size} />
    {/* Idle is the default; only a reply in progress, waiting or failed earns a dot. */}
    {entry.member.actorType === 'agent' && entry.tone !== 'quiet' && (
      <span
        aria-hidden
        {...stylex.props(
          statusStyles.state,
          statusStyles.memberDot,
          entry.tone === 'working' ? statusStyles.memberWorking : toneStyles[entry.tone],
        )}
      >
        <span {...stylex.props(statusStyles.dot)} />
      </span>
    )}
  </span>
);

export function useMemberEntries(detail: ChannelDetail) {
  const { t } = useTranslation('channel');
  const { channel, jobs = [], members: allMembers = [] } = detail;
  const entries: MemberEntry[] = getVisibleStatusMembers(allMembers, channel.workspaceId).map(
    (member) => {
      const job = member.actorType === 'agent' ? memberCurrentJob(jobs, member.id) : undefined;
      return {
        // Idle is the default and goes unlabelled; only a reply in progress or needing attention says so.
        label: member.actorType === 'agent' && job ? t(memberJobStatus(job)) : '',
        member,
        name: memberName(member, t('deletedMember')),
        tone: job ? channelJobTone(job) : 'quiet',
      };
    },
  );
  return entries;
}

/** A working member spins amber, like a running Agent in the sidebar. */
const MemberState = ({ entry }: { entry: MemberEntry }) =>
  !entry.label ? null : entry.tone === 'working' ? (
    <span {...stylex.props(statusStyles.state, statusStyles.memberWorking)}>
      <Spin size={12} style={{ color: 'inherit' }} />
      {entry.label}
    </span>
  ) : (
    <ChannelStatus hideDot label={entry.label} tone={entry.tone} />
  );

interface MemberRowProps {
  channelId: string;
  entry: MemberEntry;
  manageable: boolean;
  onAction?: () => void;
  showDescription?: boolean;
}

const MemberRow = ({ channelId, entry, manageable, onAction, showDescription }: MemberRowProps) => {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const isAgent = entry.member.actorType === 'agent';
  const { agentId } = entry.member;
  const menuItems: DropdownItem[] = [];
  if (agentId && entry.member.status === 'active' && manageable)
    menuItems.push({
      icon: <Icon icon={FolderCog} />,
      key: 'environment',
      label: t('environment.title'),
      onClick: () => {
        onAction?.();
        openChannelAgentEnvironment(channelId, entry.member);
      },
    });
  if (agentId)
    menuItems.push({
      icon: <Icon icon={ExternalLink} />,
      key: 'open',
      label: t('openAgent'),
      onClick: () => {
        onAction?.();
        navigate(`/agent/${agentId}`);
      },
    });

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      paddingBlock={6}
      {...stylex.props(stylex.defaultMarker())}
    >
      <MemberProfileTrigger member={entry.member}>
        <StatusAvatar entry={entry} size={28} />
      </MemberProfileTrigger>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis title={entry.name} weight={500}>
          {entry.name}
        </Text>
        {isAgent &&
          (showDescription ? (
            entry.member.description && (
              <Text ellipsis fontSize={12} title={entry.member.description} type="secondary">
                {entry.member.description}
              </Text>
            )
          ) : (
            <MemberState entry={entry} />
          ))}
      </Flexbox>
      {showDescription && isAgent && <MemberState entry={entry} />}
      {menuItems.length > 0 && (
        <span {...stylex.props(styles.memberActions)}>
          <DropdownMenu items={menuItems}>
            <ActionIcon
              aria-label={t('memberActionsNamed', { name: entry.name })}
              icon={MoreHorizontal}
              size="small"
              title={t('more', { ns: 'common' })}
            />
          </DropdownMenu>
        </span>
      )}
    </Flexbox>
  );
};

/**
 * The same roster and member actions in the personal popover and workspace sidebar.
 * People come first; Agents follow under their own heading when both are present.
 */
export function MemberList({
  detail,
  onAction,
  showDescription,
}: {
  detail: ChannelDetail;
  onAction?: () => void;
  /** Roomy layouts: who each member is under the name, with the status moved to the row's end. */
  showDescription?: boolean;
}) {
  const { t } = useTranslation('channel');
  const entries = useMemberEntries(detail);
  const { channel } = detail;
  const manageable = channel.canDelete && channel.status !== 'archived';
  const { agents, people } = groupMembersByActor(entries);
  const renderRow = (entry: MemberEntry) => (
    <MemberRow
      channelId={channel.id}
      entry={entry}
      key={entry.member.id}
      manageable={manageable}
      showDescription={showDescription}
      onAction={onAction}
    />
  );

  return (
    <Flexbox gap={4}>
      {people.map(renderRow)}
      {agents.length > 0 && people.length > 0 && (
        <Text
          as="h3"
          fontSize={12}
          style={{ margin: 0, paddingBlock: '12px 2px' }}
          type="secondary"
          weight={500}
        >
          {t('members.agents', { count: agents.length })}
        </Text>
      )}
      {agents.map(renderRow)}
    </Flexbox>
  );
}
