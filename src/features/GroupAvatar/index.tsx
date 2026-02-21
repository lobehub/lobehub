'use client';

import { type GroupAvatarProps } from '@lobehub/ui';
import { GroupAvatar, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useMemo } from 'react';

import { DEFAULT_AVATAR } from '@/const/meta';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

interface GroupAvatarComponentProps extends GroupAvatarProps {
  loading?: boolean;
}

const GroupAvatarComponent = memo<GroupAvatarComponentProps>(
  ({ size = 28, avatars = [], loading, ...rest }) => {
    const [userAvatar, nickName, username] = useUserStore((s) => [
      userProfileSelectors.userAvatar(s),
      userProfileSelectors.nickName(s),
      userProfileSelectors.username(s),
    ]);

    const groupAvatars = useMemo(() => {
      let displayAvatars = avatars;
      if (displayAvatars.length === 0) {
        displayAvatars = [
          {
            avatar: DEFAULT_AVATAR,
          },
        ];
      }
      return [
        {
          avatar: userAvatar || nickName || username,
          style: { color: cssVar.colorText },
        },
        ...displayAvatars,
      ];
    }, [avatars, userAvatar, nickName, username]);

    if (loading) return <Skeleton.Avatar active shape={'square'} size={size} />;

    return (
      <GroupAvatar
        avatarShape={'square'}
        cornerShape={'square'}
        size={size}
        avatars={groupAvatars.map((agent: any) => ({
          avatar: agent.avatar || DEFAULT_AVATAR,
          background: agent?.backgroundColor || undefined,
          ...agent,
        }))}
        {...rest}
      />
    );
  },
);

export default GroupAvatarComponent;
