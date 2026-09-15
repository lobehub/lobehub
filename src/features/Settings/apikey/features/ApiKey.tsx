'use client';

import { isDesktop } from '@lobechat/const';
import { Center, Empty, Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  confirmModal,
  DropdownMenu,
  Tag,
  Text,
  toast,
} from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BookOpen, Eye, MoreHorizontal, Trash } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type LiteTableColumn } from '@/components/LiteTable';
import LiteTable from '@/components/LiteTable';
import { isFullAccessApiKey } from '@/const/apiKeyScope';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { apiKeyKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { type ApiKeyItem, type CreateApiKeyParams, type UpdateApiKeyParams } from '@/types/apiKey';
import { isForbiddenError } from '@/utils/forbiddenError';

import { useWorkspaceApiKeyPolicy } from '../WorkspaceApiKeyPolicyContext';
import ApiKeyDetail from './ApiKeyDetail';
import { ApiKeyDisplay, createApiKeyModal } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-block: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  expired: css`
    color: ${cssVar.colorError};
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;

    padding-block-end: 16px;
    padding-inline: 24px;
  `,
  /* Dates and "never used / never expires" placeholders read as metadata, not
     content — keep them quieter than the name and key. */
  muted: css`
    color: ${cssVar.colorTextTertiary};
  `,
  /* The name doubles as the entry point into the detail drawer. */
  nameLink: css`
    font-weight: 500;

    tr:hover & {
      color: ${cssVar.colorLink};
    }
  `,
}));

dayjs.extend(relativeTime);

const isExpired = (apiKey: ApiKeyItem) =>
  !!apiKey.expiresAt && dayjs(apiKey.expiresAt).isBefore(dayjs());

const ApiKey: FC = () => {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspacePolicy = useWorkspaceApiKeyPolicy();

  const { allowed: canEdit, reason } = usePermission('create_content');
  // Desktop renders from app://renderer, where a relative href is denied by the
  // window-open handler — resolve the docs link against the active server origin.
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);
  const docsHref = isDesktop ? urlJoin(remoteServerUrl, '/api/v1/docs') : '/api/v1/docs';
  const canCreate = canEdit && (!activeWorkspaceId || workspacePolicy.canCreate);
  const isMemberCreationRestricted =
    !!activeWorkspaceId && !workspacePolicy.isAdmin && !workspacePolicy.canCreate;
  const manageTooltip = tc(
    'manageOnlyCreator',
    'Only the creator or a workspace owner can do this',
  );
  const createTooltip = workspacePolicy.canCreate
    ? reason
    : t('apikey.list.actions.creationRestricted');

  const { data, isLoading, mutate } = useClientDataSWR<ApiKeyItem[]>(apiKeyKeys.list(), () =>
    lambdaClient.apiKey.getApiKeys.query(),
  );

  // Detail drawer holds only the id; the item is re-derived from SWR data so
  // in-drawer edits (rename / toggle) reflect immediately after revalidation.
  const [detailId, setDetailId] = useState<string>();
  const detailApiKey = detailId ? data?.find((item) => item.id === detailId) : undefined;

  const notifyMutationError = (error: unknown) => {
    toast.error(
      isForbiddenError(error)
        ? manageTooltip
        : tc('operationFailed', 'Operation failed, please try again'),
    );
  };

  const createMutation = useMutation({
    mutationFn: (params: CreateApiKeyParams) => lambdaClient.apiKey.createApiKey.mutate(params),
    onError: notifyMutationError,
    onSuccess: () => {
      mutate();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateApiKeyParams }) =>
      lambdaClient.apiKey.updateApiKey.mutate({ id, value: params }),
    onError: notifyMutationError,
    onSuccess: () => {
      mutate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lambdaClient.apiKey.deleteApiKey.mutate({ id }),
    onError: notifyMutationError,
    onSuccess: () => {
      mutate();
    },
  });

  const handleCreate = () => {
    if (!canCreate) return;
    createApiKeyModal({
      onSubmit: async (values) => createMutation.mutateAsync(values),
    });
  };

  const confirmDelete = (apiKey: ApiKeyItem) => {
    confirmModal({
      cancelText: t('apikey.list.actions.deleteConfirm.actions.cancel'),
      content: t('apikey.list.actions.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('apikey.list.actions.deleteConfirm.actions.ok'),
      onOk: async () => {
        await deleteMutation.mutateAsync(apiKey.id);
      },
      title: t('apikey.list.actions.deleteConfirm.title'),
    });
  };

  const canDeleteRow = (apiKey: ApiKeyItem) =>
    canEdit && (apiKey.isMine !== false || workspacePolicy.isAdmin);

  const columns: LiteTableColumn<ApiKeyItem>[] = [
    {
      key: 'name',
      listSlot: 'title',
      // The name is the affordance into the detail drawer — styled as a link so
      // the row reads as navigable rather than inert.
      render: (apiKey) => (
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.nameLink}>{apiKey.name}</span>
          {apiKey.enabled === false && <Tag>{t('apikey.status.disabled')}</Tag>}
        </Flexbox>
      ),
      title: t('apikey.list.columns.name'),
    },
    {
      key: 'key',
      render: (apiKey) => (
        // Plaintext is returned only for the caller's own keys; other members'
        // rows are masked (owners can manage them but never see the secret).
        <span onClick={(e) => e.stopPropagation()}>
          {apiKey.isMine === false ? (
            <span style={{ opacity: 0.5 }}>{`sk-lh-${'*'.repeat(12)}`}</span>
          ) : apiKey.keyDecryptionFailed ? (
            <span title={t('apikey.display.unavailableDescription')}>
              {t('apikey.display.unavailable')}
            </span>
          ) : (
            <ApiKeyDisplay apiKey={apiKey.key} />
          )}
        </span>
      ),
      title: t('apikey.list.columns.key'),
      width: 220,
    },
    // A count summary can't truncate, so scopes earn a list column; the full
    // grant list still lives in the detail drawer (row click).
    {
      key: 'scopes',
      render: (apiKey) => (
        <Tag>
          {isFullAccessApiKey(apiKey.scopes)
            ? t('apikey.scopes.fullAccess')
            : t('apikey.scopes.count', { count: apiKey.scopes?.length ?? 0 })}
        </Tag>
      ),
      title: t('apikey.list.columns.scopes'),
      width: 110,
    },
    ...(activeWorkspaceId && workspacePolicy.isAdmin
      ? [
          {
            key: 'creator',
            render: (apiKey: ApiKeyItem) => apiKey.creator || '-',
            title: t('apikey.list.columns.creator'),
            width: 140,
          } satisfies LiteTableColumn<ApiKeyItem>,
        ]
      : []),
    {
      key: 'expiresAt',
      render: (apiKey) =>
        apiKey.expiresAt ? (
          <span
            className={isExpired(apiKey) ? styles.expired : undefined}
            title={apiKey.expiresAt.toLocaleString()}
          >
            {isExpired(apiKey) ? t('apikey.status.expired') : apiKey.expiresAt.toLocaleDateString()}
          </span>
        ) : (
          <span className={styles.muted}>{t('apikey.display.neverExpires')}</span>
        ),
      title: t('apikey.list.columns.expiresAt'),
      width: 130,
    },
    {
      key: 'lastUsedAt',
      render: (apiKey: ApiKeyItem) =>
        apiKey.lastUsedAt ? (
          // Relative time answers "is this key still in use?" at a glance; the
          // exact timestamp stays one hover away.
          <span title={apiKey.lastUsedAt.toLocaleString()}>
            {dayjs(apiKey.lastUsedAt).fromNow()}
          </span>
        ) : (
          <span className={styles.muted}>{t('apikey.display.neverUsed')}</span>
        ),
      title: t('apikey.list.columns.lastUsedAt'),
    },
    // Browse actions stay on the row (Vercel-token style); the drawer remains
    // the full management surface for rename / expiry / scopes. In the narrow
    // card layout the menu sits beside the name (`extra`), not under the meta.
    {
      key: 'actions',
      listSlot: 'extra',
      render: (apiKey) => (
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu
            placement={'bottomRight'}
            items={[
              {
                icon: Eye,
                key: 'view',
                label: t('apikey.list.actions.viewDetails'),
                onClick: () => setDetailId(apiKey.id),
              },
              {
                danger: true,
                disabled: !canDeleteRow(apiKey),
                icon: Trash,
                key: 'delete',
                label: t('apikey.list.actions.delete'),
                onClick: () => confirmDelete(apiKey),
              },
            ]}
          >
            <ActionIcon
              icon={MoreHorizontal}
              size={'small'}
              title={t('apikey.list.actions.more')}
            />
          </DropdownMenu>
        </span>
      ),
      title: '',
      width: 48,
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Flexbox gap={4}>
          <Text as={'h3'} style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
            {t('apikey.list.title')}
          </Text>
          <Text style={{ fontSize: 13 }} type={'secondary'}>
            {t('apikey.list.desc')}
          </Text>
        </Flexbox>
        <Flexbox horizontal gap={8}>
          <Button href={docsHref} icon={BookOpen} target="_blank" type="text">
            {t('apikey.list.actions.viewDocs')}
          </Button>
          <Button
            disabled={!canCreate}
            title={canCreate ? undefined : createTooltip}
            type="primary"
            onClick={handleCreate}
          >
            {t('apikey.list.actions.create')}
          </Button>
        </Flexbox>
      </div>
      <LiteTable
        columns={columns}
        dataSource={data}
        loading={isLoading}
        rowKey={(apiKey) => apiKey.id}
        emptyText={
          <Center height={240} width={'100%'}>
            <Empty
              description={t(
                isMemberCreationRestricted
                  ? 'apikey.list.restrictedEmpty.desc'
                  : 'apikey.list.empty',
              )}
              title={
                isMemberCreationRestricted ? t('apikey.list.restrictedEmpty.title') : undefined
              }
            />
          </Center>
        }
        onRowClick={(apiKey) => setDetailId(apiKey.id)}
      />
      <ApiKeyDetail
        apiKey={detailApiKey}
        canDelete={canEdit && !!detailApiKey && canDeleteRow(detailApiKey)}
        canEdit={canEdit && !!detailApiKey && detailApiKey.isMine !== false}
        manageTooltip={canEdit ? manageTooltip : (reason ?? manageTooltip)}
        open={!!detailApiKey}
        onClose={() => setDetailId(undefined)}
        onDelete={async (id) => {
          await deleteMutation.mutateAsync(id);
          setDetailId(undefined);
        }}
        onUpdate={async (id, params) => {
          try {
            await updateMutation.mutateAsync({ id, params });
            return true;
          } catch {
            return false;
          }
        }}
      />
    </div>
  );
};

export default ApiKey;
