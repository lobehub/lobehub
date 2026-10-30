import type { ChannelDetail } from '@lobechat/types';
import { Button, Divider, Flexbox, Text } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { openInviteMembers } from './CreateChannel';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';
import { getFormerAgentMembers, isActiveChannelMember } from './visibleMembers';

/** Keep the historical identity beside its recovery path, separate from the active roster. */
export function FormerMembers({
  detail,
  onAction,
}: {
  detail: ChannelDetail;
  onAction?: () => void;
}) {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const members = getFormerAgentMembers(detail.members);
  if (!members.length) return null;
  const canInvite = detail.channel.canDelete && detail.channel.status !== 'archived';
  return (
    <Flexbox gap={8}>
      <Divider />
      <Text fontSize={12} type="secondary" weight={500}>
        {t('members.former')}
      </Text>
      {members.map((member) => (
        <Flexbox horizontal align="center" gap={8} key={member.id}>
          <MemberAvatar member={member} size={28} />
          <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
            <Text ellipsis title={memberName(member, t('deletedMember'))}>
              {memberName(member, t('deletedMember'))}
            </Text>
            <Text fontSize={12} type="secondary">
              {t(
                member.agentDeleted || !member.agentId ? 'members.agentDeleted' : 'members.removed',
              )}
            </Text>
          </Flexbox>
        </Flexbox>
      ))}
      <Text fontSize={12} type="secondary">
        {t('members.historyKept')}
      </Text>
      {members.some((member) => member.agentDeleted && member.agentId) && (
        <Button
          size="small"
          onClick={() => {
            onAction?.();
            navigate('/settings/trash');
          }}
        >
          {t('members.openTrash')}
        </Button>
      )}
      {canInvite && (
        <Button
          size="small"
          onClick={() => {
            onAction?.();
            openInviteMembers({
              agentIds: detail.members
                .filter(isActiveChannelMember)
                .flatMap((member) => (member.agentId ? [member.agentId] : [])),
              id: detail.channel.id,
              workspaceId: detail.channel.workspaceId,
            });
          }}
        >
          {t('members.inviteAgent')}
        </Button>
      )}
    </Flexbox>
  );
}
