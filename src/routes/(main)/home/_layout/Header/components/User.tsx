'use client';

import { Plans } from '@lobechat/types';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import UserAvatar from '@/features/User/UserAvatar';
import UserPanel from '@/features/User/UserPanel';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

export const USER_DROPDOWN_ICON_ID = 'user-dropdown-icon';

const User = memo<{ lite?: boolean }>(({ lite }) => {
  const [nickname, username, isSignedIn, subscriptionPlan] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
    authSelectors.isLogin(s),
    s.subscriptionPlan,
  ]);
  const { t } = useTranslation('subscription');

  const planName =
    isSignedIn && subscriptionPlan && subscriptionPlan !== Plans.Free
      ? t(`plans.plan.${subscriptionPlan}.title`)
      : undefined;

  return (
    <UserPanel>
      <Block
        clickable
        horizontal
        align={'center'}
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
              <Flexbox style={{ flex: 1, overflow: 'hidden' }}>
                <Text
                  ellipsis
                  weight={500}
                  style={{ lineHeight: 1.4 }}
                >
                  {nickname || username}
                </Text>
                {planName && (
                  <Text ellipsis fontSize={11} style={{ lineHeight: 1.3 }} type={'secondary'}>
                    {planName}
                  </Text>
                )}
              </Flexbox>
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
