'use client';

import { type ActionType, type ProColumns, ProTable } from '@ant-design/pro-components';
import { Avatar, Flexbox, Tag } from '@lobehub/ui';
import { Button, Switch } from '@lobehub/ui/base-ui';
import { useMutation } from '@tanstack/react-query';
import { Popconfirm } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Eye, Trash } from 'lucide-react';
import { type FC, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

import { AppDetail, ClientIdDisplay, createOAuthAppModal } from './index';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    .ant-pro-card-body {
      padding-inline: 0;

      .ant-pro-table-list-toolbar-container {
        padding-block-start: 0;
      }
    }
  `,
  table: css`
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
  `,
}));

const OAuthApps: FC = () => {
  const { t } = useTranslation('auth');
  const { allowed: canEdit, reason } = usePermission('create_content');

  const actionRef = useRef<ActionType>(null);
  const [detailApp, setDetailApp] = useState<OAuthAppItem>();

  const reload = () => {
    actionRef.current?.reload();
  };

  const createMutation = useMutation({
    mutationFn: (params: Parameters<typeof lambdaClient.oauthApp.create.mutate>[0]) =>
      lambdaClient.oauthApp.create.mutate(params),
    onSuccess: reload,
  });

  const enabledMutation = useMutation({
    mutationFn: ({ enabled, id }: { enabled: boolean; id: string }) =>
      lambdaClient.oauthApp.setEnabled.mutate({ enabled, id }),
    onSuccess: reload,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => lambdaClient.oauthApp.delete.mutate({ id }),
    onSuccess: reload,
  });

  const handleCreate = () => {
    if (!canEdit) return;
    createOAuthAppModal({
      onSubmit: async (values) => {
        await createMutation.mutateAsync(values);
      },
    });
  };

  const columns: ProColumns<OAuthAppItem>[] = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (_, app) => (
        <Flexbox horizontal align={'center'} gap={8}>
          <Avatar avatar={app.logoUri || app.name} shape={'square'} size={24} title={app.name} />
          {app.name}
        </Flexbox>
      ),
      title: t('oauthApp.list.columns.name'),
    },
    {
      dataIndex: 'id',
      ellipsis: true,
      key: 'id',
      render: (_, app) => <ClientIdDisplay clientId={app.id} />,
      title: t('oauthApp.list.columns.clientId'),
      width: 240,
    },
    {
      key: 'type',
      render: () => <Tag>{t('oauthApp.type.deviceFlow')}</Tag>,
      title: t('oauthApp.list.columns.type'),
      width: 130,
    },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      renderText: (_, app) => app.createdAt?.toLocaleDateString() ?? '-',
      title: t('oauthApp.list.columns.createdAt'),
      width: 130,
    },
    {
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      renderText: (_, app) => app.lastUsedAt?.toLocaleString() ?? t('oauthApp.list.neverUsed'),
      title: t('oauthApp.list.columns.lastUsedAt'),
      width: 160,
    },
    {
      dataIndex: 'enabled',
      key: 'enabled',
      render: (_, app) => (
        <Switch
          checked={!!app.enabled}
          disabled={!canEdit}
          onChange={(checked) => {
            if (!canEdit) return;
            enabledMutation.mutate({ enabled: checked, id: app.id });
          }}
        />
      ),
      title: t('oauthApp.list.columns.status'),
      width: 100,
    },
    {
      key: 'action',
      render: (_, app) => (
        <Flexbox horizontal align={'center'} gap={4}>
          <Button
            icon={<Eye size={16} />}
            size={'small'}
            title={t('oauthApp.list.actions.view')}
            type={'text'}
            onClick={() => setDetailApp(app)}
          />
          <Popconfirm
            cancelText={t('oauthApp.deleteConfirm.cancel')}
            description={t('oauthApp.deleteConfirm.content')}
            okButtonProps={{ danger: true, disabled: !canEdit }}
            okText={t('oauthApp.deleteConfirm.ok')}
            title={t('oauthApp.deleteConfirm.title')}
            onConfirm={() => {
              if (!canEdit) return;
              deleteMutation.mutate(app.id);
            }}
          >
            <Button
              disabled={!canEdit}
              icon={<Trash size={16} />}
              size={'small'}
              title={canEdit ? t('oauthApp.list.actions.delete') : reason}
              type={'text'}
            />
          </Popconfirm>
        </Flexbox>
      ),
      title: t('oauthApp.list.columns.actions'),
      width: 100,
    },
  ];

  return (
    <div className={styles.container}>
      <ProTable
        actionRef={actionRef}
        className={styles.table}
        columns={columns}
        headerTitle={t('oauthApp.list.title')}
        options={false}
        pagination={false}
        rowKey={'id'}
        search={false}
        request={async () => {
          const apps = await lambdaClient.oauthApp.list.query();
          return { data: apps as OAuthAppItem[], success: true };
        }}
        toolbar={{
          actions: [
            <Button
              disabled={!canEdit}
              key={'create'}
              title={reason}
              type={'primary'}
              onClick={handleCreate}
            >
              {t('oauthApp.list.actions.create')}
            </Button>,
          ],
        }}
      />
      <AppDetail
        app={detailApp}
        canEdit={canEdit}
        onChanged={reload}
        onClose={() => setDetailApp(undefined)}
      />
    </div>
  );
};

export default OAuthApps;
