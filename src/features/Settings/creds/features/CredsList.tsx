'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Empty, Flexbox, Icon, Tag } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useMutation } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import MarketSignInGate from './MarketSignInGate';
import { openShareCredModal } from './ShareCredModal';
import { personalCredsApi as credsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '8px' },
  empty: { paddingBlock: '48px', paddingInline: '0' },
});

/**
 * The caller's personal credentials, on the personal settings page. Each row
 * can be shared into the caller's workspaces (see {@link openShareCredModal});
 * the workspace page lists workspace credentials through `WorkspaceCredsList`.
 */
const CredsList: FC = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const workspaces = useWorkspaces();

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const credentials = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!canManageCredentials) return;
      await credsApi.client.delete.mutate({ id });
    },
    onSuccess: () => {
      refetch();
    },
  });

  const handleEdit = (cred: UserCredSummary) => {
    createEditCredModal({ cred, credsApi, onSuccess: () => refetch() });
  };

  const handleView = (cred: UserCredSummary) => {
    createViewCredModal({ cred, credsApi });
  };

  // Self-hosted deployments have no workspaces to share into.
  const shareItems = (cred: UserCredSummary) =>
    workspaces.length > 0
      ? [
          {
            icon: <Icon icon={Share2} />,
            key: 'share',
            label: t('creds.share.menu'),
            onClick: () => openShareCredModal(cred),
          },
        ]
      : [];

  return (
    <MarketSignInGate>
      <div {...stylex.props(styles.container)}>
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'block'}
          isEmpty={credentials.length === 0}
          isLoading={isLoading}
          loading={<ListSkeleton paddingInline={0} />}
          empty={
            <Empty
              className={stylex.props(styles.empty).className}
              description={t('creds.empty')}
            />
          }
          onRetry={() => refetch()}
        >
          <Flexbox gap={0}>
            {credentials.map((cred) => (
              <CredItem
                canManage={canManageCredentials}
                cred={cred}
                extraMenuItems={shareItems(cred)}
                key={cred.id}
                tags={
                  !!cred.shares?.length && (
                    <Tag>{t('creds.share.badge', { count: cred.shares.length })}</Tag>
                  )
                }
                onDelete={(id) => deleteMutation.mutate(id)}
                onEdit={canManageCredentials ? handleEdit : undefined}
                onView={handleView}
              />
            ))}
          </Flexbox>
        </AsyncBoundary>
      </div>
    </MarketSignInGate>
  );
};

export default CredsList;
