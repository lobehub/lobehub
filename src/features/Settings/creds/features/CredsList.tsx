'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Empty, Flexbox, Icon, SearchBar, Tabs, Tag, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useMutation } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import AsyncBoundary from '@/components/AsyncBoundary';
import CredsSkeleton, { CredsListSkeleton } from '@/components/Skeleton/Settings/tabs/Creds';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';

import CreateCredMenu from './CreateCredMenu';
import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import MarketSignInGate from './MarketSignInGate';
import { openShareCredModal } from './ShareCredModal';
import { personalCredsApi as credsApi } from './useCredsApi';
import { filterVault, VAULT_CATEGORIES, type VaultCategory } from './vaultFilter';
import { createViewCredModal } from './ViewCredModal';

const styles = stylex.create({
  container: { display: 'flex', flexDirection: 'column', gap: '16px' },
  empty: { paddingBlock: '48px', paddingInline: '0' },
});

interface CredsListProps {
  mobile?: boolean;
}

/**
 * The personal vault: the caller's own credentials, on the personal settings
 * page. One toolbar row — category tabs with counts on the left, search and
 * the create menu on the right — above a list of filled card rows. A row
 * opens its item (values for key-value items, the edit form otherwise); its
 * "..." menu holds share, edit and delete. Each row can be shared into the
 * caller's workspaces (see {@link openShareCredModal}); the workspace page
 * lists workspace credentials through `WorkspaceCredsList`.
 */
const CredsList: FC<CredsListProps> = ({ mobile }) => {
  const { t } = useTranslation('setting');
  const [category, setCategory] = useState<VaultCategory>('all');
  const [keyword, setKeyword] = useState('');
  const { isAuthenticated } = useMarketAuth();
  const { allowed: canManageCredentials } = usePermission('manage_provider_key');
  const workspaces = useWorkspaces();

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const credentials = data?.data ?? [];
  const { counts, items } = filterVault(credentials, { category, keyword });

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

  // The row's own action: read a key-value item's values; other types have
  // nothing to read back, so they open their edit form.
  const handleOpen = (cred: UserCredSummary) => {
    if (cred.type === 'kv-env' || cred.type === 'kv-header') handleView(cred);
    else handleEdit(cred);
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
    <MarketSignInGate loading={<CredsSkeleton.Body />}>
      <div {...stylex.props(styles.container)}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
          <Tabs
            activeKey={category}
            style={{ flex: 'none', maxWidth: '100%', width: 'fit-content' }}
            variant={'rounded'}
            items={VAULT_CATEGORIES.map((key) => ({
              key,
              label: (
                <>
                  {t(`creds.types.${key}`)}
                  {data && (
                    <Text as={'span'} style={{ marginInlineStart: 6 }} type={'secondary'}>
                      {counts[key]}
                    </Text>
                  )}
                </>
              ),
            }))}
            onChange={(key) => setCategory(key as VaultCategory)}
          />
          <Flexbox
            horizontal
            align={'center'}
            gap={8}
            style={mobile ? { width: '100%' } : undefined}
          >
            <SearchBar
              allowClear
              placeholder={t('creds.search.placeholder')}
              style={mobile ? { flex: 1 } : { width: 220 }}
              value={keyword}
              variant={'filled'}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <CreateCredMenu size={mobile ? 'large' : undefined} onCreated={() => refetch()} />
          </Flexbox>
        </Flexbox>
        <AsyncBoundary
          data={data}
          error={error}
          errorVariant={'block'}
          isEmpty={items.length === 0}
          isLoading={isLoading}
          loading={<CredsListSkeleton variant={'card'} />}
          empty={
            <Empty
              className={stylex.props(styles.empty).className}
              description={t(credentials.length === 0 ? 'creds.empty' : 'creds.search.empty')}
            />
          }
          onRetry={() => refetch()}
        >
          <Flexbox gap={8}>
            {items.map((cred) => (
              <CredItem
                canManage={canManageCredentials}
                cred={cred}
                extraMenuItems={shareItems(cred)}
                key={cred.id}
                variant={'card'}
                tags={
                  !!cred.shares?.length && (
                    <Tag>{t('creds.share.badge', { count: cred.shares.length })}</Tag>
                  )
                }
                onClick={canManageCredentials ? handleOpen : undefined}
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
