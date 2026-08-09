'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { memo, type PropsWithChildren, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { signOut, useSession } from '@/libs/better-auth/auth-client';
import { useClientDataSWR } from '@/libs/swr';
import { controlPlaneClient } from '@/libs/trpc/client/controlPlane';

import ControlPlaneLogin from './ControlPlaneLogin';

const signOutAndReload = async () => {
  await signOut();
  window.location.reload();
};

/**
 * Only platform admins mount the control-plane panel.
 * Non-admins are signed out immediately and returned to login — they never see
 * the admin shell or the old "Only platform admins…" forbidden panel.
 */
const ControlPlaneAuthGate = memo<PropsWithChildren>(({ children }) => {
  const { t } = useTranslation('aico');
  const { data: session, isPending } = useSession();
  const rejectingRef = useRef(false);

  const userId = session?.user?.id;
  const {
    data: access,
    error: accessError,
    isLoading: accessLoading,
  } = useClientDataSWR(userId ? ['aico-control-plane-access', userId] : null, () =>
    controlPlaneClient.platformAdmin.checkAccess.query(),
  );

  const accessCode = (accessError as { data?: { code?: string } } | undefined)?.data?.code;
  const sessionBroken = Boolean(accessError && (accessCode === 'UNAUTHORIZED' || !accessCode));
  const isNotAdmin = Boolean(
    session?.user && !accessLoading && !accessError && access && !access.isPlatformAdmin,
  );

  useEffect(() => {
    if (!isNotAdmin || rejectingRef.current) return;
    rejectingRef.current = true;
    const email = session?.user?.email || session?.user?.id || '';
    toast.error(t('platform.notAdminDesc', { email }));
    void signOutAndReload();
  }, [isNotAdmin, session?.user?.email, session?.user?.id, t]);

  if (isPending || (session?.user && accessLoading) || isNotAdmin) {
    return (
      <Flexbox padding={48}>
        <Text type="secondary">{t('platform.loginChecking')}</Text>
      </Flexbox>
    );
  }

  if (!session?.user || sessionBroken) {
    return <ControlPlaneLogin />;
  }

  // Unexpected tRPC failure after auth — stay off the admin panel
  if (accessError || !access?.isPlatformAdmin) {
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
          {session.user.email}
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
