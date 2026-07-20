'use client';

import { Flexbox } from '@lobehub/ui';
import { Empty, Spin } from 'antd';
import { createStaticStyles } from 'antd-style';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { lambdaQuery } from '@/libs/trpc/client';
import CredItem from '@/routes/(main)/settings/creds/features/CredItem';

import ShareToggle from './ShareToggle';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 32px;
    padding-inline: 0;
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
 * Personal tab of the workspace credential page: the caller's own *personal*
 * credentials, each with a {@link ShareToggle} to share/unshare it into the
 * current workspace's Market organization. The page provides the outlined
 * list container; this component renders only the list body.
 *
 * Rows are share-only — no "..." action menu. Editing/deleting here is gated
 * by the owner-only `manage_provider_key` workspace permission, which the
 * caller's own credentials shouldn't answer to, so for most members the menu
 * could only ever render disabled; CRUD lives on the personal settings page.
 *
 * Always queries the personal `market.creds` namespace directly — never
 * `useCredsApi()` — since that hook resolves to `workspaceCreds` on this page
 * and this section is deliberately personal-scoped regardless of page context.
 */
const PersonalCredsSection: FC<PersonalCredsSectionProps> = ({ onWorkspaceCredsChange }) => {
  const { t } = useTranslation('setting');

  const { data, error, isLoading, refetch } = lambdaQuery.market.creds.list.useQuery(undefined);

  // Refreshes both this personal list and the workspace tab's list: a
  // share/unshare/visibility change alters what the org-scoped merged list
  // should return, and that list has no way to know on its own.
  const refetchLists = async () => {
    await Promise.all([refetch(), onWorkspaceCredsChange()]);
  };

  const credentials = data?.data ?? [];

  return (
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
          />
        ))}
      </Flexbox>
    </AsyncBoundary>
  );
};

export default PersonalCredsSection;
