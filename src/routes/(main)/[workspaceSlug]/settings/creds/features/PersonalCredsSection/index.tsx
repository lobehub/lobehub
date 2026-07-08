'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import CredItem from '@/routes/(main)/settings/creds/features/CredItem';
import { createEditCredModal } from '@/routes/(main)/settings/creds/features/EditCredModal';
import { createViewCredModal } from '@/routes/(main)/settings/creds/features/ViewCredModal';

import ShareToggle from './ShareToggle';

// Always the personal namespace — this section is deliberately personal-scoped
// regardless of page context, so it bypasses `useCredsApi()` entirely.
const personalCredsApi = { client: lambdaClient.market.creds, query: lambdaQuery.market.creds };

const styles = createStaticStyles(({ css }) => ({
  desc: css`
    margin-block-end: 12px;
    font-size: 13px;
    color: var(--lobe-color-text-secondary);
  `,
  empty: css`
    padding-block: 32px;
    padding-inline: 0;
  `,
  title: css`
    margin-block-end: 4px;
    font-size: 16px;
    font-weight: 600;
  `,
}));

interface PersonalCredsSectionProps {
  /**
   * Called after a share/unshare/visibility change succeeds. The workspace
   * section above reads a disjoint credential set (org-scoped), so it has no
   * way to know this section's mutations should invalidate it — the parent
   * page wires this to its own `workspaceCreds.list` query's `refetch`.
   * Returns a promise: {@link ShareToggle} awaits it (alongside this
   * section's own refetch) before releasing its optimistic pending state, so
   * the toggle never snaps to a different value after already looking settled.
   */
  onWorkspaceCredsChange: () => Promise<unknown>;
}

/**
 * Bottom section of the workspace creds page: the caller's own *personal*
 * credentials, each with a {@link ShareToggle} to share/unshare it into the
 * current workspace's Market organization.
 *
 * Always queries the personal `market.creds` namespace directly — never
 * `useCredsApi()` — since that hook resolves to `workspaceCreds` on this page
 * and this section is deliberately personal-scoped regardless of page context.
 */
const PersonalCredsSection: FC<PersonalCredsSectionProps> = ({ onWorkspaceCredsChange }) => {
  const { t } = useTranslation('setting');

  const { data, error, isLoading, refetch } = lambdaQuery.market.creds.list.useQuery(undefined);

  // Refreshes both this personal list and the workspace section above.
  // Deleting or editing a credential that's currently shared/public changes
  // what the workspace's merged list should show (a removed credential, or
  // updated name/description) just as much as share/unshare/visibility does
  // — the workspace section has no way to know on its own, since it reads a
  // disjoint (org-scoped) query.
  const refetchLists = async () => {
    await Promise.all([refetch(), onWorkspaceCredsChange()]);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await lambdaClient.market.creds.delete.mutate({ id });
    },
    onSuccess: refetchLists,
  });

  const credentials = data?.data ?? [];

  const handleEdit = (cred: UserCredSummary) => {
    createEditCredModal({
      credsApi: personalCredsApi,
      cred,
      onSuccess: refetchLists,
    });
  };

  const handleView = (cred: UserCredSummary) => {
    createViewCredModal({ credsApi: personalCredsApi, cred });
  };

  return (
    <Flexbox gap={0} style={{ marginBlockStart: 32 }}>
      <Text className={styles.title}>{t('creds.personalSection.title')}</Text>
      <Text className={styles.desc}>{t('creds.personalSection.desc')}</Text>
      <AsyncBoundary
        data={data}
        empty={<Empty className={styles.empty} description={t('creds.empty')} />}
        error={error}
        errorVariant={'block'}
        isEmpty={credentials.length === 0}
        isLoading={isLoading}
        loading={
          <Flexbox align={'center'} justify={'center'} style={{ padding: 32 }}>
            <Spin />
          </Flexbox>
        }
        onRetry={() => refetch()}
      >
        <Flexbox gap={0}>
          {credentials.map((cred) => (
            <CredItem
              cred={cred}
              extra={<ShareToggle cred={cred} onChange={refetchLists} />}
              key={cred.id}
              onDelete={(id) => deleteMutation.mutate(id)}
              onEdit={handleEdit}
              onView={handleView}
            />
          ))}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
};

export default PersonalCredsSection;
