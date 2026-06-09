'use client';

import { ActionIcon, Block, Flexbox, Text } from '@lobehub/ui';
import { Settings2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface AccountHeaderProps {
  onNavigate?: () => void;
}

const AccountHeader = memo<AccountHeaderProps>(({ onNavigate }) => {
  const { t } = useTranslation('common');
  const [nickname, username, email] = useUserStore((s) => [
    userProfileSelectors.nickName(s),
    userProfileSelectors.username(s),
    userProfileSelectors.email(s),
  ]);

  const displayName = nickname || username || '';

  return (
    <Link style={{ color: 'inherit', display: 'block' }} to={'/settings'} onClick={onNavigate}>
      <Block
        clickable
        horizontal
        align={'center'}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        variant={'borderless'}
      >
        <Flexbox flex={1} gap={2} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Text ellipsis style={{ lineHeight: 1.4 }} weight={'bold'}>
            {displayName}
          </Text>
          {email && (
            <Text ellipsis fontSize={12} style={{ lineHeight: 1.4 }} type={'secondary'}>
              {email}
            </Text>
          )}
        </Flexbox>
        <ActionIcon icon={Settings2} size={'small'} tabIndex={-1} title={t('userPanel.setting')} />
      </Block>
    </Link>
  );
});

AccountHeader.displayName = 'AccountHeader';

export default AccountHeader;
