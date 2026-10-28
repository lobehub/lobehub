'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button, Empty, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useMutation } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { LogIn } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

import { credsApiForRow, isActionableCredRow } from './credAccess';
import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import { defaultCredsApi, useCredsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '8px' },
  empty: { paddingBlock: '48px', paddingInline: '0' },
  signInPrompt: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px',
  },
});

const CredsList: FC = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated, isLoading: isAuthLoading, session, signIn } = useMarketAuth();
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const credsApi = useCredsApi();
  const myAccountId = session?.userInfo?.accountId;

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const credentials = data?.data ?? [];

  // See credAccess.ts for the ownership/routing rules this applies.
  const isActionable = (cred: UserCredSummary) => isActionableCredRow(cred, myAccountId);
  const apiFor = (cred: UserCredSummary) =>
    credsApiForRow(cred, myAccountId, credsApi, defaultCredsApi);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!canManageCredentials) return;
      const cred = credentials.find((c) => c.id === id);
      if (!cred || !isActionable(cred)) return;
      await apiFor(cred).client.delete.mutate({ id });
    },
    onSuccess: () => {
      refetch();
    },
  });

  const handleEdit = (cred: UserCredSummary) => {
    if (!isActionable(cred)) return;
    createEditCredModal({
      cred,
      credsApi: apiFor(cred),
      onSuccess: () => refetch(),
    });
  };

  const handleView = (cred: UserCredSummary) => {
    if (!isActionable(cred)) return;
    createViewCredModal({ cred, credsApi: apiFor(cred) });
  };

  if (isAuthLoading) {
    return <ListSkeleton paddingInline={0} />;
  }

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

  // Org not created: guide users to complete Community Profile setup first.
  if (!isLoading && error instanceof TRPCClientError && error.data?.code === 'NOT_FOUND') {
    return (
      <div {...stylex.props(styles.signInPrompt)}>
        <Empty description={t('creds.orgSetupRequired')} />
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.container)}>
      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'block'}
        isEmpty={credentials.length === 0}
        isLoading={isLoading}
        loading={<ListSkeleton paddingInline={0} />}
        empty={
          <Empty className={stylex.props(styles.empty).className} description={t('creds.empty')} />
        }
        onRetry={() => refetch()}
      >
        <Flexbox gap={0}>
          {credentials.map((cred) => {
            // Another member's shared row: no endpoint this UI can reach for
            // it (see the isActionable doc comment above) — omit the action
            // handlers entirely so CredItem renders the row with no "..."
            // menu / view button, instead of a menu whose actions silently
            // no-op.
            const actionable = isActionable(cred);
            return (
              <CredItem
                cred={cred}
                key={cred.id}
                onDelete={actionable ? (id) => deleteMutation.mutate(id) : undefined}
                onEdit={actionable && canManageCredentials ? (cred) => handleEdit(cred) : undefined}
                onView={actionable ? handleView : undefined}
              />
            );
          })}
        </Flexbox>
      </AsyncBoundary>
    </div>
  );
};

export default CredsList;
