'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import UserAvatar from '@/features/User/UserAvatar';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import { useCreateAgent } from '../useCreateAgent';
import { styles } from './SessionHeader/style';

const Header = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed, create, loading, reason } = useCreateAgent();
  const navigate = useNavigate();

  return (
    <ChatHeader
      style={mobileHeaderSticky}
      left={
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.leftContainer).className}
          gap={8}
        >
          <UserAvatar size={32} onClick={() => navigate('/me')} />
          <ProductLogo type={'text'} />
        </Flexbox>
      }
      right={
        <ActionIcon
          aria-description={reason}
          aria-label={t('newAgent')}
          disabled={!allowed || loading}
          icon={MessageSquarePlus}
          loading={loading}
          size={MOBILE_HEADER_ICON_SIZE}
          title={reason ?? t('newAgent')}
          onClick={() => create()}
        />
      }
    />
  );
});

export default Header;
