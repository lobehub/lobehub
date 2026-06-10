'use client';

import { ActionIcon, Block, type MenuProps, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MoreHorizontal } from 'lucide-react';
import { memo, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/features/User/UserAvatar';
import UpgradeBadge from '@/features/User/UserPanel/UpgradeBadge';
import { useNewVersion } from '@/features/User/UserPanel/useNewVersion';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';

import AccountPanel from '.';

const styles = createStaticStyles(({ css }) => ({
  trigger: css`
    &:hover:not(:has(.account-trigger-actions:hover)) .account-trigger-more {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

interface AccountTriggerProps {
  actions?: ReactNode;
  extraItems?: MenuProps['items'];
}

const AccountTrigger = memo<AccountTriggerProps>(({ actions, extraItems }) => {
  const { t } = useTranslation('common');
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const [nickname, username] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
  ]);
  const hasNewVersion = useNewVersion();

  const stopPropagation = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  if (!isSignedIn) return null;

  const displayName = nickname || username || '';

  return (
    <UpgradeBadge showBadge={hasNewVersion}>
      <AccountPanel extraItems={extraItems}>
        <Block
          clickable
          horizontal
          align={'center'}
          aria-label={t('userPanel.profile')}
          className={styles.trigger}
          flex={1}
          gap={8}
          title={t('userPanel.profile')}
          variant={'borderless'}
          style={{
            height: 36,
            minWidth: 0,
            paddingBlock: 4,
            paddingInline: 6,
          }}
        >
          <UserAvatar background={cssVar.colorFill} clickable={false} size={24} />
          {displayName && (
            <Text
              ellipsis
              fontSize={13}
              style={{ flex: 1, lineHeight: 1, minWidth: 0 }}
              weight={500}
            >
              {displayName}
            </Text>
          )}
          <ActionIcon
            className={'account-trigger-more'}
            icon={MoreHorizontal}
            size={'small'}
            tabIndex={-1}
          />
          {actions && (
            <div
              className={'account-trigger-actions'}
              style={{ display: 'flex', flex: 'none' }}
              onClick={stopPropagation}
              onPointerDown={stopPropagation}
            >
              {actions}
            </div>
          )}
        </Block>
      </AccountPanel>
    </UpgradeBadge>
  );
});

AccountTrigger.displayName = 'AccountTrigger';

export default AccountTrigger;
