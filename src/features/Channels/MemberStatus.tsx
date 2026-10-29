import type { ChannelDetail } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Popover, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCloseOnNavigate } from '@/hooks/useCloseOnNavigate';

import { openInviteMembers } from './CreateChannel';
import { FailureIndicator } from './FailureIndicator';
import { MemberList, StatusAvatar, useMemberEntries } from './MemberList';
import { statusStyles, styles } from './styles';

/** Header avatars before the rest fold into a count; the list shows everyone. */
const MAX_VISIBLE = 5;

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
  const { channel, members: allMembers = [] } = detail;
  // An archived channel is read-only: no new members or environment changes until reopened.
  const manageable = channel.canDelete && channel.status !== 'archived';
  const entries = useMemberEntries(detail);
  const overflow = entries.length - MAX_VISIBLE;
  const title = t('membersCount', { count: entries.length });

  return (
    <Flexbox horizontal align="center" gap={4}>
      <FailureIndicator detail={detail} />
      {memberPanel ? (
        <ActionIcon
          active={memberPanel.open}
          aria-controls={memberPanel.open ? memberPanel.id : undefined}
          aria-expanded={memberPanel.open}
          aria-label={t(memberPanel.open ? 'members.hide' : 'members.show')}
          icon={Users}
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
            {entries.slice(0, MAX_VISIBLE).map((entry) => (
              <StatusAvatar entry={entry} key={entry.member.id} size={24} />
            ))}
            {overflow > 0 && <span {...stylex.props(styles.muted)}>+{overflow}</span>}
          </Button>
        </Popover>
      )}
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
