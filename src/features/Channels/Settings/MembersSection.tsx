import type { ChannelDetail } from '@lobechat/types';
import { Button } from '@lobehub/ui';
import { UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { canInviteMembers } from '../channelAccess';
import { openInviteMembers } from '../CreateChannel';
import { MemberList, useMemberEntries } from '../MemberList';
import { FormCard } from './FormCard';

export function MembersSection({ detail }: { detail: ChannelDetail }) {
  const { t } = useTranslation('channel');
  const { channel, members } = detail;
  const entries = useMemberEntries(detail);

  return (
    <FormCard
      plain
      description={t('settings.members.description')}
      title={t('membersCount', { count: entries.length })}
      headerAction={
        canInviteMembers(channel) && (
          <Button
            icon={UserPlus}
            onClick={() =>
              openInviteMembers({
                agentIds: members.flatMap((member) =>
                  member.status === 'active' && member.agentId ? [member.agentId] : [],
                ),
                id: channel.id,
                workspaceId: channel.workspaceId,
              })
            }
          >
            {t('invite.title')}
          </Button>
        )
      }
    >
      <MemberList showDescription detail={detail} />
    </FormCard>
  );
}
