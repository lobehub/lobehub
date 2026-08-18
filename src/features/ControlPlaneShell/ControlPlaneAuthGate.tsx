'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { controlPlaneClient } from '@/libs/trpc/client/controlPlane';

import ControlPlaneLogin from './ControlPlaneLogin';

const signOutAndReload = async () => {
  await fetch('/api/admin/sign-out', { credentials: 'include', method: 'POST' });
  window.location.reload();
};

/**
 * Only platform operators mount the control-plane panel.
 * Chat Better Auth sessions are ignored — operators use /api/admin/sign-in.
 */
const ControlPlaneAuthGate = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('aico');

  const { data: access, isLoading: accessLoading } = useClientDataSWR(
    ['aico-control-plane-access'],
    () => controlPlaneClient.platformAdmin.checkAccess.query(),
  );

  if (accessLoading) {
    return (
      <Flexbox padding={48}>
        <Text type="secondary">{t('platform.loginChecking')}</Text>
      </Flexbox>
    );
  }

  if (!access?.isPlatformAdmin) {
    return <ControlPlaneLogin />;
  }

  return (
    <Flexbox gap={12} style={{ background: 'transparent', minHeight: '100dvh', width: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        gap={12}
        justify="flex-end"
        paddingBlock={12}
        paddingInline={24}
      >
        <Text style={{ fontSize: 13 }} type="secondary">
          {access.email}
        </Text>
        <Button size="small" onClick={() => void signOutAndReload()}>
          {t('platform.signOut')}
        </Button>
      </Flexbox>
      {children}
    </Flexbox>
  );
});

ControlPlaneAuthGate.displayName = 'ControlPlaneAuthGate';

export default ControlPlaneAuthGate;
