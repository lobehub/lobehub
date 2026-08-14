'use client';

import { isDesktop } from '@lobechat/const';
import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { createStaticStyles } from 'antd-style';
import { BookOpen, ChevronRight } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type LiteTableColumn } from '@/components/LiteTable';
import LiteTable from '@/components/LiteTable';
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
  /* Always visible, not reveal-on-hover: the row's only job besides browsing is
     to lead into the detail drawer, and a marker you must hover to discover
     doesn't advertise that. Quiet by default, darker under the cursor. */
  enterIcon: css`
    color: ${cssVar.colorTextQuaternary};
    transition: color 0.2s ease;

    tr:hover & {
      color: ${cssVar.colorText};
    }
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding-block-end: 16px;
    padding-inline: 24px;
  `,
  /* The name doubles as the entry point into the detail drawer. */
  nameLink: css`
    font-weight: 500;

    tr:hover & {
      color: ${cssVar.colorLink};
    }
  `,
}));

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
      onSubmit: async (values) => {
        await createMutation.mutateAsync(values);
      },
    });
  };

  const columns: LiteTableColumn<ApiKeyItem>[] = [
    {
      key: 'name',
      listSlot: 'title',
      // The name is the affordance into the detail drawer — styled as a link so
      // the row reads as navigable rather than inert.
      render: (apiKey) => <span className={styles.nameLink}>{apiKey.name}</span>,
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
      width: 230,
    },
    // Scopes are deliberately absent from the list: the column could only ever
    // truncate, and the detail drawer (row click) shows the full grant list.
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
      render: (apiKey) => apiKey.expiresAt?.toLocaleString() || t('apikey.display.neverExpires'),
      title: t('apikey.list.columns.expiresAt'),
      width: 170,
    },
    {
      key: 'lastUsedAt',
      render: (apiKey: ApiKeyItem) =>
        apiKey.lastUsedAt?.toLocaleString() || t('apikey.display.neverUsed'),
      title: t('apikey.list.columns.lastUsedAt'),
    },
    // Every management action (rename, expiry, enable/disable, delete) lives in
    // the detail drawer: the list browses, the drawer owns one key's surface.
    {
      key: 'enter',
      render: () => <ChevronRight className={styles.enterIcon} size={16} />,
      title: '',
      width: 40,
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text as={'h3'} style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
          {t('apikey.list.title')}
        </Text>
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
        canEdit={canEdit && !!detailApiKey && detailApiKey.isMine !== false}
        manageTooltip={canEdit ? manageTooltip : (reason ?? manageTooltip)}
        open={!!detailApiKey}
        canDelete={
          canEdit && !!detailApiKey && (detailApiKey.isMine !== false || workspacePolicy.isAdmin)
        }
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
