'use client';

import { type UserCredSummary } from '@lobechat/types';
import { Empty, Flexbox, Icon, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { EyeOffIcon, GlobeIcon, LockIcon, UsersIcon } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import Avatar from '@/components/Avatar';
import { CredsListSkeleton } from '@/components/Skeleton/Settings/tabs/Creds';
import { matchesVisibilityFilter, type VisibilityFilterValue } from '@/components/VisibilityFilter';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { confirmCredModal } from './confirmCredModal';
import { isOwnCredRow, isWriteOnlyCredRow, workspaceCredRowAccess } from './credAccess';
import { credErrorKey } from './credError';
import { type CredFilter, filterCreds } from './credFilter';
import CredItem from './CredItem';
import { createEditCredModal } from './EditCredModal';
import { type CredsApi } from './useCredsApi';
import { createViewCredModal } from './ViewCredModal';
import { type CredDetailAction } from './ViewCredModal/Content';

type Visibility = 'private' | 'public';

interface WorkspaceCredsListProps {
  /** The workspace binding (`workspaceCreds`), with `setVisibility`. */
  credsApi: CredsApi;
  /** The vault toolbar's search and type filter; every row when omitted. */
  filter?: CredFilter;
  /** Narrow the list to private or shared credentials; every row when omitted. */
  visibilityFilter?: VisibilityFilterValue;
}

/**
 * The workspace credential list. `workspaceCreds.list` already returns only
 * what the caller can see — shared credentials plus their own private ones —
 * so it is listed as is, private rows marked with a lock. A row is a
 * workspace credential or a member's personal credential shared in; see
 * `credAccess.ts` for who may do what with each.
 */
const WorkspaceCredsList: FC<WorkspaceCredsListProps> = ({
  credsApi,
  filter = {},
  visibilityFilter = 'all',
}) => {
  const { t } = useTranslation(['setting', 'common']);
  const { session } = useMarketAuth();
  const { allowed: isAdmin } = usePermission('manage_provider_key');
  const myAccountId = session?.userInfo?.accountId;
  const myAvatar = useUserStore(userProfileSelectors.userAvatar);
  const myName = useUserStore(userProfileSelectors.displayUserName);

  const { data, error, isLoading, refetch } = credsApi.query.list.useQuery();
  const credentials = data?.data ?? [];
  const visibleCredentials = filterCreds(credentials, filter).filter((cred) =>
    matchesVisibilityFilter(cred.visibility === 'private', visibilityFilter),
  );

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
    confirmCredModal({
      content: <VisibilityConfirmContent variant={'publish'} />,
      okText: t('creds.visibility.publish'),
      onOk: () => run(() => changeVisibility(cred, 'public')),
      title: t('creds.visibility.publishConfirmTitle'),
    });

  const handleMakePrivate = (cred: UserCredSummary) =>
    confirmCredModal({
      content: <VisibilityConfirmContent variant={'makePrivate'} />,
      danger: true,
      okText: t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: () => run(() => changeVisibility(cred, 'private')),
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });

  const handleUnshare = (cred: UserCredSummary) =>
    confirmCredModal({
      content: t('creds.share.unshareConfirmDesc'),
      danger: true,
      okText: t('creds.share.revoke'),
      onOk: () => run(() => lambdaClient.market.creds.unshare.mutate({ id: cred.id })),
      title: t('creds.share.unshareConfirmTitle'),
    });

  const handleDelete = (id: number) => run(() => credsApi.client.delete.mutate({ id }));

  /**
   * Who a row belongs to: a shared personal credential names its owner; a
   * workspace credential is attributed only when the viewer created it —
   * Market returns no profile for other creators.
   */
  const authorOf = (cred: UserCredSummary): { avatar?: string; name: string } | undefined => {
    if (cred.ownerType === 'user') {
      return isOwnCredRow(cred, myAccountId)
        ? { avatar: myAvatar, name: myName }
        : cred.ownerDisplayName
          ? { name: cred.ownerDisplayName }
          : undefined;
    }
    if (myAccountId !== undefined && cred.createdByAccountId === myAccountId) {
      return { avatar: myAvatar, name: myName };
    }
    return undefined;
  };

  const visibilityLabel = (cred: UserCredSummary) =>
    cred.visibility === 'private'
      ? t('visibilityFilter.private', { ns: 'common' })
      : t('visibilityFilter.workspace', { ns: 'common' });

  return (
    <AsyncBoundary
      data={data}
      empty={<Empty description={t('creds.empty')} style={{ paddingBlock: 48 }} />}
      error={error}
      errorVariant={'block'}
      isEmpty={credentials.length === 0}
      isLoading={isLoading}
      loading={<CredsListSkeleton />}
      onRetry={() => refetch()}
    >
      <Flexbox gap={0}>
        {visibleCredentials.length === 0 && (
          <Empty
            description={t('visibilityFilter.empty', { ns: 'common' })}
            style={{ paddingBlock: 48 }}
          />
        )}
        {visibleCredentials.map((cred) => {
          const access = workspaceCredRowAccess(cred, { isAdmin, myAccountId });
          const writeOnly = isWriteOnlyCredRow(cred);
          const author = authorOf(cred);
          const actions: CredDetailAction[] = [
            ...(access.publish
              ? [
                  {
                    icon: GlobeIcon,
                    key: 'publish',
                    label: t('creds.visibility.publish'),
                    onClick: () => handlePublish(cred),
                  },
                ]
              : []),
            ...(access.makePrivate
              ? [
                  {
                    icon: EyeOffIcon,
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
                    key: 'unshare',
                    label: t('creds.share.revoke'),
                    onClick: () => handleUnshare(cred),
                  },
                ]
              : []),
          ];

          return (
            <CredItem
              cred={cred}
              key={cred.id}
              extra={
                <>
                  {author && (
                    <Tooltip title={author.name}>
                      <span data-testid={`cred-author-${cred.id}`} style={{ display: 'flex' }}>
                        <Avatar
                          avatar={author.avatar}
                          name={author.name}
                          size={24}
                          title={author.name}
                        />
                      </span>
                    </Tooltip>
                  )}
                </>
              }
              titleSuffix={
                <Tooltip title={visibilityLabel(cred)}>
                  <span
                    aria-label={visibilityLabel(cred)}
                    data-testid={`cred-visibility-${cred.id}`}
                    data-visibility={cred.visibility === 'private' ? 'private' : 'workspace'}
                    role={'img'}
                    style={{
                      color: cssVar.colorTextTertiary,
                      display: 'inline-flex',
                      flex: 'none',
                    }}
                  >
                    <Icon icon={cred.visibility === 'private' ? LockIcon : UsersIcon} size={14} />
                  </span>
                </Tooltip>
              }
              onClick={() =>
                createViewCredModal({
                  actions,
                  canReadValues: access.manage && !writeOnly,
                  cred,
                  credsApi,
                  extraItems: [
                    {
                      children: visibilityLabel(cred),
                      key: 'visibility',
                      label: t('creds.detail.visibility'),
                    },
                    ...(author
                      ? [
                          {
                            children:
                              cred.ownerType === 'user' && isOwnCredRow(cred, myAccountId)
                                ? t('creds.owner.fromPersonal')
                                : author.name,
                            key: 'author',
                            label: t('creds.detail.author'),
                          },
                        ]
                      : []),
                  ],
                  onDelete: access.manage ? handleDelete : undefined,
                  onEdit: access.manage
                    ? () =>
                        createEditCredModal({
                          cred,
                          credsApi,
                          onSuccess: () => refetch(),
                          writeOnly,
                        })
                    : undefined,
                  valuesHint: access.manage && writeOnly ? t('creds.writeOnly.tooltip') : undefined,
                })
              }
            />
          );
        })}
      </Flexbox>
    </AsyncBoundary>
  );
};

export default WorkspaceCredsList;
