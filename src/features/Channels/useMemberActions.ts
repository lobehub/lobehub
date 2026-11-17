import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useLatest } from 'ahooks';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';

import { matchChannel } from './paths';

/** Confirms, then removes a person or an Agent from a group Channel. */
export const useRemoveMember = () => {
  const { t } = useTranslation('channel');
  return (
    channel: Pick<ChannelListItem, 'id' | 'projectId'>,
    member: ChannelPublicMember,
    name: string,
  ) => {
    const scope = cacheScope.get();
    return confirmModal({
      cancelText: t('cancel'),
      content: t(
        member.actorType === 'user'
          ? 'member.removeConfirmPerson'
          : channel.projectId
            ? 'member.removeConfirmAgent'
            : 'member.removeConfirmAgentStandalone',
      ),
      okButtonProps: { danger: true },
      okText: t('member.remove'),
      title: t('member.removeConfirmTitle', { name }),
      onOk: async () => {
        try {
          // A confirmation belongs to the identity that opened it.
          if (cacheScope.get() !== scope) throw new Error('Channel scope changed');
          await channelActions.removeMember(channel.id, member.id);
        } catch (error) {
          console.error('Failed to remove a Channel member', error);
          toast.error(t('member.removeFailed', { name }));
          throw error; // Keep the confirmation open so the user can retry or cancel.
        }
      },
    });
  };
};

/**
 * Confirms, then leaves a group Channel. A Channel the caller can no longer read (outside a
 * project, archived, or in a project they cannot see) returns its page home; an active open
 * project Channel stays readable through its project.
 */
export const useLeaveChannel = () => {
  const { t } = useTranslation('channel');
  const location = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();
  const latest = useLatest({ location, navigate });

  return (channel: Pick<ChannelListItem, 'id' | 'projectId' | 'status' | 'title'>) => {
    const scope = cacheScope.get();
    return confirmModal({
      cancelText: t('cancel'),
      // An archived project Channel takes no newcomers, so leaving it is final too.
      content: t(
        channel.projectId && channel.status === 'active' ? 'leaveConfirmProject' : 'leaveConfirm',
      ),
      okButtonProps: { danger: true },
      okText: t('leave'),
      title: t('leaveConfirmTitle', { title: channel.title }),
      onOk: async () => {
        let readable: boolean;
        try {
          if (cacheScope.get() !== scope) throw new Error('Channel scope changed');
          readable = await channelActions.leave(channel);
        } catch (error) {
          console.error('Failed to leave Channel', error);
          toast.error(t('leaveFailed'));
          throw error;
        }
        if (cacheScope.get() !== scope) return;
        if (!readable && matchChannel(latest.current.location.pathname) === channel.id)
          latest.current.navigate('/', { replace: true });
        toast.success(t('leaveSuccess'));
      },
    });
  };
};
