'use client';

import { type ActionType, type ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { Center, Empty } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { App, Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash } from 'lucide-react';
import { type FC } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageableChecker } from '@/hooks/useResourceManageable';
import { lambdaClient } from '@/libs/trpc/client';
import { type ApiKeyItem, type CreateApiKeyParams, type UpdateApiKeyParams } from '@/types/apiKey';
import { isForbiddenError } from '@/utils/forbiddenError';

import { ApiKeyDisplay, createApiKeyModal, EditableCell } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    .ant-pro-card-body {
      padding-inline: 0;

      .ant-pro-table-list-toolbar-container {
        padding-block-start: 0;
      }
    }
  `,
  header: css`
    display: flex;
    justify-content: flex-end;
    margin-block-end: ${cssVar.margin};
  `,
  table: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
}));

const ApiKey: FC = () => {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  const { message } = App.useApp();
  const { allowed: canEdit, reason } = usePermission('create_content');
  // Workspace row-level ownership: only the creator or a workspace owner may
  // edit / toggle / delete a key — mirrors the server-side enforcement.
  const checkManageable = useResourceManageableChecker();
  const manageTooltip = tc(
    'manageOnlyCreator',
    'Only the creator or a workspace owner can do this',
  );

  const actionRef = useRef<ActionType>(null);

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
      actionRef.current?.reload();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateApiKeyParams }) =>
      lambdaClient.apiKey.updateApiKey.mutate({ id, value: params }),
    onError: notifyMutationError,
    onSuccess: () => {
      actionRef.current?.reload();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lambdaClient.apiKey.deleteApiKey.mutate({ id }),
    onError: notifyMutationError,
    onSuccess: () => {
      actionRef.current?.reload();
    },
  });

  const handleCreate = () => {
    if (!canEdit) return;
    createApiKeyModal({
      onSubmit: async (values) => {
        await createMutation.mutateAsync(values);
      },
    });
  };

  const columns: ProColumns<ApiKeyItem>[] = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, apiKey) => {
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
      dataIndex: 'key',
      ellipsis: true,
      key: 'key',
      render: (_, apiKey) =>
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
            dataIndex: 'creator',
            key: 'creator',
            renderText: (_: unknown, apiKey: ApiKeyItem) => apiKey.creator || '-',
            title: t('apikey.list.columns.creator'),
            width: 140,
          } satisfies ProColumns<ApiKeyItem>,
        ]
      : []),
    {
      dataIndex: 'enabled',
      key: 'enabled',
      render: (_, apiKey: ApiKeyItem) => {
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
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (_, apiKey) => {
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
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      renderText: (_, apiKey: ApiKeyItem) =>
        apiKey.lastUsedAt?.toLocaleString() || t('apikey.display.neverUsed'),
      title: t('apikey.list.columns.lastUsedAt'),
    },
    {
      key: 'action',
      render: (_: any, apiKey: ApiKeyItem) => {
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
      <ProTable
        actionRef={actionRef}
        className={styles.table}
        columns={columns}
        headerTitle={t('apikey.list.title')}
        options={false}
        pagination={false}
        rowKey="id"
        search={false}
        locale={{
          emptyText: (
            <Center height={240} width={'100%'}>
              <Empty description={t('apikey.list.empty')} />
            </Center>
          ),
        }}
        request={async () => {
          const apiKeys = await lambdaClient.apiKey.getApiKeys.query();

          return {
            data: apiKeys,
            success: true,
          };
        }}
        toolbar={{
          actions: [
            <Button
              disabled={!canEdit}
              key="create"
              title={reason}
              type="primary"
              onClick={handleCreate}
            >
              {t('apikey.list.actions.create')}
            </Button>,
          ],
        }}
      />
    </div>
  );
};

export default ApiKey;
