'use client';

import { Center, Empty, Text } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { App, Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash } from 'lucide-react';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type LiteTableColumn } from '@/components/LiteTable';
import LiteTable from '@/components/LiteTable';
import { usePermission } from '@/hooks/usePermission';
import { useClientDataSWR } from '@/libs/swr';
import { apiKeyKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type ApiKeyItem, type CreateApiKeyParams, type UpdateApiKeyParams } from '@/types/apiKey';
import { isForbiddenError } from '@/utils/forbiddenError';

import { ApiKeyDisplay, createApiKeyModal, EditableCell } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding-block: 16px;
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding-block-end: 16px;
    padding-inline: 24px;
  `,
}));

const ApiKey: FC = () => {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const { message } = App.useApp();
  const { allowed: canEdit, reason } = usePermission('create_content');
  // Workspace API keys are shared admin config: the server gates every
  // mutation (create included) at Admin-or-higher
  // (`requireWorkspaceRoleWhenScoped('admin')`), with no per-row creator
  // check — mirror that here so Admins can manage keys created by other
  // members and Members don't get an enabled create flow that always 403s.
  const { allowed: canManageKeys } = usePermission('manage_settings');
  const canCreate = canEdit && (!activeWorkspaceId || canManageKeys);
  const checkManageable = (_creatorUserId?: string | null) => !activeWorkspaceId || canManageKeys;
  const manageTooltip = tc(
    'manageOnlyCreator',
    'Only the creator or a workspace owner can do this',
  );

  const { data, isLoading, mutate } = useClientDataSWR<ApiKeyItem[]>(apiKeyKeys.list(), () =>
    lambdaClient.apiKey.getApiKeys.query(),
  );

  const notifyMutationError = (error: unknown) => {
    message.error(
      isForbiddenError(error)
        ? manageTooltip
        : tc('operationFailed', 'Operation failed, please try again'),
    );
  };

  const createMutation = useMutation({
    mutationFn: (params: CreateApiKeyParams) => lambdaClient.apiKey.createApiKey.mutate(params),
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
      render: (apiKey) => {
        const canManage = checkManageable(apiKey.userId);
        return (
          <span title={canManage ? undefined : manageTooltip}>
            <EditableCell
              disabled={!canEdit || !canManage}
              placeholder={t('apikey.display.enterPlaceholder')}
              type="text"
              value={apiKey.name}
              onSubmit={(name) => {
                if (!canEdit || !canManage) return;
                if (!name || name === apiKey.name) {
                  return;
                }

                updateMutation.mutate({ id: apiKey.id!, params: { name: name as string } });
              }}
            />
          </span>
        );
      },
      title: t('apikey.list.columns.name'),
    },
    {
      key: 'key',
      render: (apiKey) =>
        // Plaintext is returned only for the caller's own keys; other members'
        // rows are masked (owners can manage them but never see the secret).
        apiKey.isMine === false ? (
          <span style={{ opacity: 0.5 }}>{`lb-${'*'.repeat(12)}`}</span>
        ) : apiKey.keyDecryptionFailed ? (
          <span title={t('apikey.display.unavailableDescription')}>
            {t('apikey.display.unavailable')}
          </span>
        ) : (
          <ApiKeyDisplay apiKey={apiKey.key} />
        ),
      title: t('apikey.list.columns.key'),
      width: 230,
    },
    ...(activeWorkspaceId
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
      key: 'enabled',
      listSlot: 'extra',
      render: (apiKey: ApiKeyItem) => {
        const canManage = checkManageable(apiKey.userId);
        return (
          <span style={{ display: 'inline-flex' }} title={canManage ? undefined : manageTooltip}>
            <Switch
              checked={!!apiKey.enabled}
              disabled={!canEdit || !canManage}
              onChange={(checked) => {
                if (!canEdit || !canManage) return;
                updateMutation.mutate({ id: apiKey.id!, params: { enabled: checked } });
              }}
            />
          </span>
        );
      },
      title: t('apikey.list.columns.status'),
      width: 100,
    },
    {
      key: 'expiresAt',
      render: (apiKey) => {
        const canManage = checkManageable(apiKey.userId);
        return (
          <span title={canManage ? undefined : manageTooltip}>
            <EditableCell
              disabled={!canEdit || !canManage}
              placeholder={t('apikey.display.neverExpires')}
              type="date"
              value={apiKey.expiresAt?.toLocaleString() || t('apikey.display.neverExpires')}
              onSubmit={(expiresAt) => {
                if (!canEdit || !canManage) return;
                if (expiresAt === apiKey.expiresAt) {
                  return;
                }

                updateMutation.mutate({
                  id: apiKey.id!,
                  params: { expiresAt: expiresAt ? new Date(expiresAt as string) : null },
                });
              }}
            />
          </span>
        );
      },
      title: t('apikey.list.columns.expiresAt'),
      width: 170,
    },
    {
      key: 'lastUsedAt',
      render: (apiKey: ApiKeyItem) =>
        apiKey.lastUsedAt?.toLocaleString() || t('apikey.display.neverUsed'),
      title: t('apikey.list.columns.lastUsedAt'),
    },
    {
      key: 'action',
      listSlot: 'actions',
      render: (apiKey: ApiKeyItem) => {
        const canManage = checkManageable(apiKey.userId);
        return (
          <Popconfirm
            cancelText={t('apikey.list.actions.deleteConfirm.actions.cancel')}
            description={t('apikey.list.actions.deleteConfirm.content')}
            okButtonProps={{ disabled: !canEdit || !canManage }}
            okText={t('apikey.list.actions.deleteConfirm.actions.ok')}
            title={t('apikey.list.actions.deleteConfirm.title')}
            onConfirm={async () => {
              if (!canEdit || !canManage) return;
              await deleteMutation.mutateAsync(apiKey.id!);
            }}
          >
            <Button
              disabled={!canEdit || !canManage}
              icon={Trash}
              size="small"
              style={{ verticalAlign: 'middle' }}
              type="text"
              title={
                canEdit && canManage
                  ? t('apikey.list.actions.delete')
                  : canEdit
                    ? manageTooltip
                    : reason
              }
            />
          </Popconfirm>
        );
      },
      title: t('apikey.list.columns.actions'),
      width: 100,
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text as={'h3'} style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
          {t('apikey.list.title')}
        </Text>
        <Button
          disabled={!canCreate}
          title={canCreate ? undefined : canEdit ? manageTooltip : reason}
          type="primary"
          onClick={handleCreate}
        >
          {t('apikey.list.actions.create')}
        </Button>
      </div>
      <LiteTable
        columns={columns}
        dataSource={data}
        loading={isLoading}
        rowKey={(apiKey) => apiKey.id}
        emptyText={
          <Center height={240} width={'100%'}>
            <Empty description={t('apikey.list.empty')} />
          </Center>
        }
      />
    </div>
  );
};

export default ApiKey;
