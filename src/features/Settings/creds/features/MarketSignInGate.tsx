'use client';

import { Button, Empty } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { LogIn } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import ListSkeleton from '@/components/ListSkeleton';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

const styles = stylex.create({
  signInPrompt: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
  },
});

/**
 * Credentials live in the Market account: until the user is signed in to the
 * Market, show a sign-in prompt instead of `children`.
 */
const MarketSignInGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation('setting');
  const { isAuthenticated, isLoading, signIn } = useMarketAuth();

  if (isLoading) return <ListSkeleton paddingInline={0} />;

  if (!isAuthenticated) {
    return (
      <div {...stylex.props(styles.signInPrompt)}>
        <Empty description={t('creds.signInRequired')} />
        <Button icon={LogIn} type={'primary'} onClick={() => signIn()}>
          {t('creds.signIn')}
        </Button>
      </div>
    );
  }

  return children;
};

export default MarketSignInGate;
