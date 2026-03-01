'use client';

import { type ActionType, type ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { Button } from '@lobehub/ui';
import { useMutation } from '@tanstack/react-query';
import { Popconfirm, Switch } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Trash } from 'lucide-react';
import { type FC } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';
import { type ApiKeyItem, type CreateApiKeyParams, type UpdateApiKeyParams } from '@/types/apiKey';

import { ApiKeyDisplay, ApiKeyModal, EditableCell } from './index';

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
  const [modalOpen, setModalOpen] = useState(false);

  const actionRef = useRef<ActionType>(null);

  const createMutation = useMutation({
    mutationFn: (params: CreateApiKeyParams) => lambdaClient.apiKey.createApiKey.mutate(params),
    onSuccess: () => {
      actionRef.current?.reload();
      setModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, params }: { id: string; params: UpdateApiKeyParams }) =>
      lambdaClient.apiKey.updateApiKey.mutate({ id, value: params }),
    onSuccess: () => {
      actionRef.current?.reload();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lambdaClient.apiKey.deleteApiKey.mutate({ id }),
    onSuccess: () => {
      actionRef.current?.reload();
    },
  });

  const handleCreate = () => {
    setModalOpen(true);
  };

  const handleModalOk = (values: CreateApiKeyParams) => {
    createMutation.mutate(values);
  };

  const columns: ProColumns<ApiKeyItem>[] = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, apiKey) => (
        <EditableCell
          placeholder={t('apikey.display.enterPlaceholder')}
          type="text"
          value={apiKey.name}
          onSubmit={(name) => {
            if (!name || name === apiKey.name) {
              return;
            }

            updateMutation.mutate({ id: apiKey.id!, params: { name: name as string } });
          }}
        />
      ),
      title: t('apikey.list.columns.name'),
    },
    {
      dataIndex: 'key',
      ellipsis: true,
      key: 'key',
      render: (_, apiKey) => <ApiKeyDisplay apiKey={apiKey.key} />,
      title: t('apikey.list.columns.key'),
      width: 230,
    },
    {
      dataIndex: 'enabled',
      key: 'enabled',
      render: (_, apiKey: ApiKeyItem) => (
        <Switch
          checked={!!apiKey.enabled}
          onChange={(checked) => {
            updateMutation.mutate({ id: apiKey.id!, params: { enabled: checked } });
          }}
        />
      ),
      title: t('apikey.list.columns.status'),
      width: 100,
    },
    {
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (_, apiKey) => (
        <EditableCell
          placeholder={t('apikey.display.neverExpires')}
          type="date"
          value={apiKey.expiresAt?.toLocaleString() || t('apikey.display.neverExpires')}
          onSubmit={(expiresAt) => {
            if (expiresAt === apiKey.expiresAt) {
              return;
            }

            updateMutation.mutate({
              id: apiKey.id!,
              params: { expiresAt: expiresAt ? new Date(expiresAt as string) : null },
            });
          }}
        />
      ),
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
      render: (_: any, apiKey: ApiKeyItem) => (
        <Popconfirm
          cancelText={t('apikey.list.actions.deleteConfirm.actions.cancel')}
          description={t('apikey.list.actions.deleteConfirm.content')}
          okText={t('apikey.list.actions.deleteConfirm.actions.ok')}
          title={t('apikey.list.actions.deleteConfirm.title')}
          onConfirm={() => deleteMutation.mutate(apiKey.id!)}
        >
          <Button
            icon={Trash}
            size="small"
            style={{ verticalAlign: 'middle' }}
            title={t('apikey.list.actions.delete')}
            type="text"
          />
        </Popconfirm>
      ),
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
        request={async () => {
          const apiKeys = await lambdaClient.apiKey.getApiKeys.query();

          return {
            data: apiKeys,
            success: true,
          };
        }}
        toolbar={{
          actions: [
            <Button key="create" type="primary" onClick={handleCreate}>
              {t('apikey.list.actions.create')}
            </Button>,
          ],
        }}
      />
      <ApiKeyModal
        open={modalOpen}
        submitLoading={createMutation.isPending}
        onCancel={() => setModalOpen(false)}
        onOk={handleModalOk}
      />
    </div>
  );
};

export default ApiKey;
