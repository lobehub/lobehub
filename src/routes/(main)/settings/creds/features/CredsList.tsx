'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LogIn } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import { useCredsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  empty: css`
    padding-block: 48px;
    padding-inline: 0;
  `,
  signInPrompt: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: center;

    padding: 48px;
  `,
}));

const CredsList: FC = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const credsApi = useCredsApi();

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!canManageCredentials) return;
      await credsApi.client.delete.mutate({ id });
    },
    onSuccess: () => {
      refetch();
    },
  });

  const credentials = data?.data ?? [];

  const handleEdit = (cred: UserCredSummary) => {
    createEditCredModal({
      cred,
      credsApi,
      onSuccess: () => refetch(),
    });
  };

  const handleView = (cred: UserCredSummary) => {
    createViewCredModal({ cred, credsApi });
  };

  if (isAuthLoading) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
        <Spin />
      </Flexbox>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={styles.signInPrompt}>
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
      <div className={styles.signInPrompt}>
        <Empty description={t('creds.orgSetupRequired')} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <AsyncBoundary
        data={data}
        empty={<Empty className={styles.empty} description={t('creds.empty')} />}
        error={error}
        errorVariant={'block'}
        isEmpty={credentials.length === 0}
        isLoading={isLoading}
        loading={
          <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
            <Spin />
          </Flexbox>
        }
        onRetry={() => refetch()}
      >
        <Flexbox gap={0}>
          {credentials.map((cred) => (
            <CredItem
              cred={cred}
              key={cred.id}
              onDelete={(id) => deleteMutation.mutate(id)}
              onView={handleView}
              onEdit={(cred) => {
                if (!canManageCredentials) return;
                handleEdit(cred);
              }}
            />
          ))}
        </Flexbox>
      </AsyncBoundary>
    </div>
  );
};

export default CredsList;
