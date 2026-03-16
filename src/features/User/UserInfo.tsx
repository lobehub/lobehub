'use client';

import { type FlexboxProps } from '@lobehub/ui';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

import ThemeButton from '@/features/User/UserPanel/ThemeButton';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import { type UserAvatarProps } from './UserAvatar';
import UserAvatar from './UserAvatar';

export interface UserInfoProps extends FlexboxProps {
  avatarProps?: Partial<UserAvatarProps>;
  onClick?: () => void;
}

const UserInfo = memo<UserInfoProps>(({ avatarProps, onClick, ...rest }) => {
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.displayUserName(s),
  ]);

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={12}
      justify={'space-between'}
      paddingBlock={12}
      paddingInline={12}
      {...rest}
    >
      <Flexbox horizontal align={'center'} gap={10} onClick={onClick}>
        <UserAvatar background={cssVar.colorFill} size={36} {...(avatarProps as any)} />
        <Flexbox flex={1}>
          <Text style={{ lineHeight: 1.4 }} weight={'bold'}>
            {nickname}
          </Text>
          {username && (
            <Text fontSize={12} style={{ lineHeight: 1.4 }} type={'secondary'}>
              {username}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
      {isSignedIn && <ThemeButton placement={'right'} size={16} />}
    </Flexbox>
  );
});

export default UserInfo;
