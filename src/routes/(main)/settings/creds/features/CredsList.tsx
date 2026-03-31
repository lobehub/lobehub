'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { LogIn } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

import CredItem from './CredItem';
import EditCredModal from './EditCredModal';
import ViewCredModal from './ViewCredModal';

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
  const [editingCred, setEditingCred] = useState<UserCredSummary | null>(null);
  const [viewingCred, setViewingCred] = useState<UserCredSummary | null>(null);
  const { isAuthenticated, isLoading: isAuthLoading, signIn } = useMarketAuth();

  const { data, isLoading, refetch } = lambdaQuery.market.creds.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => lambdaClient.market.creds.delete.mutate({ id }),
    onSuccess: () => {
      refetch();
    },
  });

  const credentials = data?.data ?? [];

  const handleEditSuccess = () => {
    setEditingCred(null);
    refetch();
  };

  // Show loading while checking auth status
  if (isAuthLoading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 48 }}>
        <Spin />
      </Flexbox>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className={styles.signInPrompt}>
        <Empty description={t('creds.signInRequired')} />
        <Button icon={LogIn} type="primary" onClick={() => signIn()}>
          {t('creds.signIn')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {isLoading ? (
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flexbox>
      ) : credentials.length === 0 ? (
        <Empty className={styles.empty} description={t('creds.empty')} />
      ) : (
        <Flexbox gap={0}>
          {credentials.map((cred) => (
            <CredItem
              cred={cred}
              key={cred.id}
              onDelete={(id) => deleteMutation.mutate(id)}
              onEdit={setEditingCred}
              onView={setViewingCred}
            />
          ))}
        </Flexbox>
      )}

      <EditCredModal
        cred={editingCred}
        open={!!editingCred}
        onClose={() => setEditingCred(null)}
        onSuccess={handleEditSuccess}
      />
      <ViewCredModal cred={viewingCred} open={!!viewingCred} onClose={() => setViewingCred(null)} />
    </div>
  );
};

export default CredsList;
