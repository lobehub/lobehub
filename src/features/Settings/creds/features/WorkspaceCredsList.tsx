'use client';

import { type UserCredSummary } from '@lobechat/types';
import { confirmModal, Empty, Flexbox, Icon, Tag, toast } from '@lobehub/ui';
import { EyeOffIcon, GlobeIcon, Link2Off } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';

import { isOwnCredRow, workspaceCredRowAccess } from './credAccess';
import { credErrorKey } from './credError';
import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import { type CredsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';

type Visibility = 'private' | 'public';

interface WorkspaceCredsListProps {
  /** The workspace binding (`workspaceCreds`), with `setVisibility`. */
  credsApi: CredsApi;
  /** Which tab: credentials shared with every member, or the caller's private ones. */
  visibility: Visibility;
}

/**
 * One tab of the workspace credential page, mirroring the device page's
 * Workspace / Private split. `workspaceCreds.list` already returns only what
 * the caller can see — shared credentials plus their own private ones — so
 * each tab is a filter on `visibility`. A row is a workspace credential or a
 * member's personal credential shared in; see `credAccess.ts` for who may do
 * what with each.
 */
const WorkspaceCredsList: FC<WorkspaceCredsListProps> = ({ credsApi, visibility }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { session } = useMarketAuth();
  const { allowed: isAdmin } = usePermission('manage_provider_key');
  const myAccountId = session?.userInfo?.accountId;

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery();
  const credentials = (data?.data ?? []).filter((cred) => cred.visibility === visibility);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refetch();
    } catch (error) {
      toast.error(t(credErrorKey(error, 'creds.share.error')));
    }
  };

  /**
   * A workspace credential changes visibility through `workspaceCreds`; a
   * shared personal credential through its owner's share into this
   * workspace (`market.creds`, scoped to the active workspace).
   */
  const changeVisibility = (cred: UserCredSummary, next: Visibility) =>
    cred.ownerType === 'user'
      ? next === 'public'
        ? lambdaClient.market.creds.publish.mutate({ id: cred.id })
        : lambdaClient.market.creds.share.mutate({ id: cred.id, visibility: 'private' })
      : credsApi.setVisibility!(cred.id, next);

  const handlePublish = (cred: UserCredSummary) =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'publish'} />,
      okText: t('creds.visibility.publish'),
      onOk: () => run(() => changeVisibility(cred, 'public')),
      title: t('creds.visibility.publishConfirmTitle'),
    });

  const handleMakePrivate = (cred: UserCredSummary) =>
    confirmModal({
      content: <VisibilityConfirmContent variant={'makePrivate'} />,
      okButtonProps: { danger: true },
      okText: t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: () => run(() => changeVisibility(cred, 'private')),
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });

  const handleUnshare = (cred: UserCredSummary) =>
    confirmModal({
      content: t('creds.share.unshareConfirmDesc'),
      okButtonProps: { danger: true },
      okText: t('creds.share.revoke'),
      onOk: () => run(() => lambdaClient.market.creds.unshare.mutate({ id: cred.id })),
      title: t('creds.share.unshareConfirmTitle'),
    });

  const handleDelete = (id: number) => run(() => credsApi.client.delete.mutate({ id }));

  return (
    <AsyncBoundary
      data={data}
      error={error}
      errorVariant={'block'}
      isEmpty={credentials.length === 0}
      isLoading={isLoading}
      loading={<ListSkeleton paddingInline={0} />}
      empty={
        <Empty
          description={t(visibility === 'private' ? 'creds.privateSection.empty' : 'creds.empty')}
          style={{ paddingBlock: 48 }}
        />
      }
      onRetry={() => refetch()}
    >
      <Flexbox gap={0}>
        {credentials.map((cred) => {
          const access = workspaceCredRowAccess(cred, { isAdmin, myAccountId });
          const extraMenuItems = [
            ...(access.publish
              ? [
                  {
                    icon: <Icon icon={GlobeIcon} />,
                    key: 'publish',
                    label: t('creds.visibility.publish'),
                    onClick: () => handlePublish(cred),
                  },
                ]
              : []),
            ...(access.makePrivate
              ? [
                  {
                    icon: <Icon icon={EyeOffIcon} />,
                    key: 'makePrivate',
                    label: t('makePrivate', { ns: 'common' }),
                    onClick: () => handleMakePrivate(cred),
                  },
                ]
              : []),
            ...(access.unshare
              ? [
                  {
                    danger: true,
                    icon: <Icon icon={Link2Off} />,
                    key: 'unshare',
                    label: t('creds.share.revoke'),
                    onClick: () => handleUnshare(cred),
                  },
                ]
              : []),
          ];

          return (
            <CredItem
              canManage={access.manage}
              cred={cred}
              extraMenuItems={extraMenuItems}
              key={cred.id}
              tags={
                cred.ownerType === 'user' && (
                  <Tag>
                    {isOwnCredRow(cred, myAccountId)
                      ? t('creds.owner.fromPersonal')
                      : t('creds.owner.sharedBy', { name: cred.ownerDisplayName })}
                  </Tag>
                )
              }
              onDelete={access.manage ? handleDelete : undefined}
              onView={access.manage ? (cred) => createViewCredModal({ cred, credsApi }) : undefined}
              onEdit={
                access.manage
                  ? (cred) => createEditCredModal({ cred, credsApi, onSuccess: () => refetch() })
                  : undefined
              }
            />
          );
        })}
      </Flexbox>
    </AsyncBoundary>
  );
};

export default WorkspaceCredsList;
