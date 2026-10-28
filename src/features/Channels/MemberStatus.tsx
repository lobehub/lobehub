import type { ChannelDetail, ChannelPublicMember } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Popover, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, FolderCog, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useCloseOnNavigate } from '@/hooks/useCloseOnNavigate';

import { openChannelAgentEnvironment } from './AgentEnvironment';
import { ChannelStatus } from './ChannelStatus';
import { openInviteMembers } from './CreateChannel';
import { FailureIndicator } from './FailureIndicator';
import type { ChannelStatusTone } from './jobStatus';
import { channelJobStatus, channelJobTone, memberCurrentJob } from './jobStatus';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { statusStyles, styles, toneStyles } from './styles';
import { getVisibleStatusMembers } from './visibleMembers';

/** Header avatars before the rest fold into a count; the list shows everyone. */
const MAX_VISIBLE = 5;

interface MemberEntry {
  label: string;
  member: ChannelPublicMember;
  name: string;
  tone: ChannelStatusTone;
}

const StatusAvatar = ({ entry, size }: { entry: MemberEntry; size: number }) => (
  <span {...stylex.props(statusStyles.memberAvatar)}>
    <MemberAvatar member={entry.member} size={size} />
    {entry.member.actorType === 'agent' && (
      <span
        aria-hidden
        {...stylex.props(statusStyles.state, statusStyles.memberDot, toneStyles[entry.tone])}
      >
        <span {...stylex.props(statusStyles.dot)} />
      </span>
    )}
  </span>
);

/**
 * Members as avatars with live status dots. One click lists everyone by name, because
 * Agents often share the default avatar and a long roster would not fit the header.
 */
export function MemberStatus({ detail }: { detail: ChannelDetail }) {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const [open, setOpen] = useState(false);
  const popoverKey = useCloseOnNavigate(open, () => setOpen(false));
  const { channel, jobs = [], members: allMembers = [] } = detail;
  // An archived channel is read-only: no new members or environment changes until reopened.
  const manageable = channel.canDelete && channel.status !== 'archived';
  const entries: MemberEntry[] = getVisibleStatusMembers(allMembers, channel.workspaceId).map(
    (member) => {
      const job = member.actorType === 'agent' ? memberCurrentJob(jobs, member.id) : undefined;
      return {
        label: member.actorType === 'agent' ? t(job ? channelJobStatus(job) : 'status.idle') : '',
        member,
        name: memberName(member, t('deletedMember')),
        tone: job ? channelJobTone(job) : 'quiet',
      };
    },
  );
  const overflow = entries.length - MAX_VISIBLE;
  const title = t('membersCount', { count: entries.length });

  return (
    <Flexbox horizontal align="center" gap={4}>
      <FailureIndicator detail={detail} />
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
            {entries.map((entry) => (
              <Flexbox horizontal align="center" gap={8} key={entry.member.id} paddingBlock={6}>
                <StatusAvatar entry={entry} size={28} />
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text ellipsis weight={500}>
                    {entry.name}
                  </Text>
                  {entry.member.actorType === 'agent' ? (
                    <ChannelStatus label={entry.label} tone={entry.tone} />
                  ) : (
                    <span {...stylex.props(styles.muted)}>{t('person')}</span>
                  )}
                </Flexbox>
                {entry.member.agentId && entry.member.status === 'active' && manageable && (
                  <ActionIcon
                    aria-label={t('environment.editNamed', { name: entry.name })}
                    icon={FolderCog}
                    size="small"
                    title={t('environment.title')}
                    onClick={() => {
                      setOpen(false);
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
                    onClick={() => navigate(`/agent/${entry.member.agentId}`)}
                  />
                )}
              </Flexbox>
            ))}
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
          {entries.slice(0, MAX_VISIBLE).map((entry) => (
            <StatusAvatar entry={entry} key={entry.member.id} size={24} />
          ))}
          {overflow > 0 && <span {...stylex.props(styles.muted)}>+{overflow}</span>}
        </Button>
      </Popover>
      {manageable && (
        <ActionIcon
          aria-label={t('invite.title')}
          icon={UserPlus}
          size="small"
          title={t('invite.title')}
          onClick={() =>
            openInviteMembers({
              agentIds: allMembers.flatMap((member) =>
                member.status === 'active' && member.agentId ? [member.agentId] : [],
              ),
              id: channel.id,
              workspaceId: channel.workspaceId,
            })
          }
        />
      )}
    </Flexbox>
  );
}
