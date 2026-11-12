import type { ChannelDetail, ChannelPublicMember } from '@lobechat/types';
import { ActionIcon, Flexbox, Spin, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, FolderCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { openChannelAgentEnvironment } from './AgentEnvironment';
import { ChannelStatus } from './ChannelStatus';
import type { ChannelStatusTone } from './jobStatus';
import { channelJobTone, memberCurrentJob, memberJobStatus } from './jobStatus';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { statusStyles, styles, toneStyles } from './styles';
import { getVisibleStatusMembers } from './visibleMembers';

interface MemberEntry {
  label: string;
  member: ChannelPublicMember;
  name: string;
  tone: ChannelStatusTone;
}

export const StatusAvatar = ({ entry, size }: { entry: MemberEntry; size: number }) => (
  <span {...stylex.props(statusStyles.memberAvatar)}>
    <MemberAvatar member={entry.member} size={size} />
    {entry.member.actorType === 'agent' && (
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
        label: member.actorType === 'agent' ? t(job ? memberJobStatus(job) : 'status.idle') : '',
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
  entry.tone === 'working' ? (
    <span {...stylex.props(statusStyles.state, statusStyles.memberWorking)}>
      <Spin size={12} style={{ color: 'inherit' }} />
      {entry.label}
    </span>
  ) : (
    <ChannelStatus hideDot label={entry.label} tone={entry.tone} />
  );

/** The same roster and member actions in the personal popover and workspace sidebar. */
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
  const navigate = useWorkspaceAwareNavigate();
  const entries = useMemberEntries(detail);
  const { channel } = detail;
  const manageable = channel.canDelete && channel.status !== 'archived';
  return (
    <Flexbox gap={4}>
      {entries.map((entry) => (
        <Flexbox horizontal align="center" gap={8} key={entry.member.id} paddingBlock={6}>
          <StatusAvatar entry={entry} size={28} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis title={entry.name} weight={500}>
              {entry.name}
            </Text>
            {showDescription && entry.member.actorType === 'agent' ? (
              entry.member.description && (
                <Text ellipsis fontSize={12} title={entry.member.description} type="secondary">
                  {entry.member.description}
                </Text>
              )
            ) : entry.member.actorType === 'agent' ? (
              <MemberState entry={entry} />
            ) : (
              <span {...stylex.props(styles.muted)}>{t('person')}</span>
            )}
          </Flexbox>
          {showDescription && entry.member.actorType === 'agent' && <MemberState entry={entry} />}
          {entry.member.agentId && entry.member.status === 'active' && manageable && (
            <ActionIcon
              aria-label={t('environment.editNamed', { name: entry.name })}
              icon={FolderCog}
              size="small"
              title={t('environment.title')}
              onClick={() => {
                onAction?.();
                openChannelAgentEnvironment(channel.id, entry.member);
              }}
            />
          )}
          {entry.member.agentId && (
            <ActionIcon
              aria-label={t('openAgentNamed', { name: entry.name })}
              icon={ExternalLink}
              size="small"
              title={t('openAgent')}
              onClick={() => {
                onAction?.();
                navigate(`/agent/${entry.member.agentId}`);
              }}
            />
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
}
