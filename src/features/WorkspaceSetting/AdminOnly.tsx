'use client';

import { Flexbox, FluentEmoji } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsWorkspaceLoading } from '@/business/client/hooks/useIsWorkspaceLoading';
import { useIsWorkspaceOwner } from '@/business/client/hooks/useIsWorkspaceOwner';
import { MAX_WIDTH } from '@/const/layoutTokens';

const Forbidden = memo(() => {
  const { t } = useTranslation('error');
  return (
    <Flexbox align={'center'} justify={'center'} style={{ minHeight: '100%', width: '100%' }}>
      <h1
        style={{
          filter: 'blur(8px)',
          fontSize: `min(${MAX_WIDTH / 3}px, 50vw)`,
          fontWeight: 'bolder',
          margin: 0,
          opacity: 0.12,
          position: 'absolute',
          zIndex: 0,
        }}
      >
        403
      </h1>
      <FluentEmoji emoji={'🚫'} size={64} />
      <h2 style={{ fontWeight: 'bold', marginTop: '1em', textAlign: 'center' }}>
        {t('forbidden.title')}
      </h2>
      <div style={{ lineHeight: '1.8', marginBottom: '2em', textAlign: 'center' }}>
        {t('forbidden.desc')}
      </div>
      <Button type={'primary'} onClick={() => (window.location.href = '/')}>
        {t('forbidden.backHome')}
      </Button>
    </Flexbox>
  );
});

Forbidden.displayName = 'WorkspaceAdminOnlyForbidden';

const AdminOnly = memo<{ children: ReactNode }>(({ children }) => {
  const isLoading = useIsWorkspaceLoading();
  const isOwner = useIsWorkspaceOwner();

  // Don't paint the 403 before workspace context resolves — `myRole` is `null`
  // during bootstrap, which would briefly flash the forbidden screen for owners
  // landing directly on the URL.
  if (isLoading) return null;
  if (!isOwner) return <Forbidden />;
  return <>{children}</>;
});

AdminOnly.displayName = 'WorkspaceAdminOnly';

export default AdminOnly;
