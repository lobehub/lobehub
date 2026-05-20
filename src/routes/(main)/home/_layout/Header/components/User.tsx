'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import UserPanel from '@/features/User/UserPanel';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

export const USER_DROPDOWN_ICON_ID = 'user-dropdown-icon';

// The dropdown is a button surface, not selectable text. Without
// `user-select: none` a triple-click (or click-drag through the avatar /
// name) paints the system text-selection highlight across the whole row;
// that bright blue is heavier than the Sidebar's active-route fill below
// and inverts the visual hierarchy.
const styles = createStaticStyles(({ css }) => ({
  trigger: css`
    user-select: none;
  `,
}));

const User = memo<{ lite?: boolean }>(({ lite }) => {
  const [nickname, username, isSignedIn] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
    authSelectors.isLogin(s),
  ]);

  return (
    <UserPanel>
      <Block
        clickable
        horizontal
        align={'center'}
        className={styles.trigger}
        gap={8}
        paddingBlock={2}
        variant={'borderless'}
        style={{
          minWidth: 32,
          overflow: 'hidden',
          paddingInlineEnd: lite ? 2 : 8,
          paddingInlineStart: 2,
        }}
      >
        <UserAvatar shape={'square'} size={28} />
        {!lite && (
          <Flexbox horizontal align={'center'} gap={4} style={{ overflow: 'hidden' }}>
            {!isSignedIn && (nickname || username) ? (
              <ProductLogo color={cssVar.colorText} size={28} type={'text'} />
            ) : (
              <Text ellipsis style={{ flex: 1 }} weight={500}>
                {nickname || username}
              </Text>
            )}
            <Icon
              color={cssVar.colorTextDescription}
              icon={ChevronDownIcon}
              id={USER_DROPDOWN_ICON_ID}
            />
          </Flexbox>
        )}
      </Block>
    </UserPanel>
  );
});

export default User;
