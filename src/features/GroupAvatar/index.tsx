'use client';

import { type GroupAvatarProps } from '@lobehub/ui';
import { cssVar, GroupAvatar, Skeleton } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { toStackAvatar } from '@/components/AgentAvatar/stackAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

interface GroupAvatarComponentProps extends GroupAvatarProps {
  background?: string;
  loading?: boolean;
}

const GroupAvatarComponent = memo<GroupAvatarComponentProps>(
  ({ size = 28, avatars = [], background, loading, ...rest }) => {
    const [userAvatar, nickName, username] = useUserStore((s) => [
      userProfileSelectors.userAvatar(s),
      userProfileSelectors.nickName(s),
      userProfileSelectors.username(s),
    ]);

    const groupAvatars = useMemo(() => {
      const displayAvatars = avatars.length > 0 ? avatars : [{}];

      return [
        {
          avatar: userAvatar || nickName || username,
          style: { color: cssVar.colorText },
        },
        ...displayAvatars.map((agent, index) =>
          typeof agent === 'string' ? agent : toStackAvatar(agent, index),
        ),
      ];
    }, [avatars, userAvatar, nickName, username]);

    if (loading) return <Skeleton.Avatar shape={'square'} size={size} />;

    return (
      <GroupAvatar
        avatarShape={'square'}
        cornerShape={'square'}
        size={size}
        avatars={groupAvatars.map((agent: any) => ({
          background: agent?.backgroundColor || undefined,
          ...agent,
        }))}
        style={
          background && background !== 'rgba(0,0,0,0)'
            ? { background, borderRadius: '22%' }
            : undefined
        }
        {...rest}
      />
    );
  },
);

export default GroupAvatarComponent;
