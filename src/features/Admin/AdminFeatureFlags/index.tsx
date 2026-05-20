'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Badge, Button, Form, Input, Modal, Switch, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { InfoIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { type CSSProperties, memo, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

const useStyles = createStaticStyles(({ css, token }) => ({
  tableWrap: css`
    background: ${token.colorBgContainer};
    border-radius: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    overflow: hidden;
    margin-top: 16px;
  `,
}));

type FlagRow = {
  key: string;
  label: string;
  description?: string | null;
  defaultEnabled: boolean;
  enabledUserIds: string[];
  disabledUserIds: string[];
  updatedAt: Date | null;
};

const AdminFeatureFlags = memo(() => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FlagRow | null>(null);

  const { data: flags, isLoading, refetch } = lambdaQuery.admin.listFeatureFlags.useQuery();

  const upsertMutation = lambdaQuery.admin.upsertFeatureFlag.useMutation({
    onError: () => message.error('Failed to save feature flag'),
    onSuccess: () => {
      message.success('Feature flag saved');
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      refetch();
    },
  });

  const deleteMutation = lambdaQuery.admin.deleteFeatureFlag.useMutation({
    onError: () => message.error('Failed to delete flag'),
    onSuccess: () => {
      message.success('Flag deleted');
      refetch();
    },
  });

  const openCreate = () => {
    form.resetFields();
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (flag: FlagRow) => {
    setEditing(flag);
    form.setFieldsValue({
      key: flag.key,
      label: flag.label,
      description: flag.description,
      defaultEnabled: flag.defaultEnabled,
    });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      upsertMutation.mutate(values);
    });
  };

  const columns: ColumnsType<FlagRow> = [
    {
      dataIndex: 'key',
      key: 'key',
      render: (key) => <code style={{ fontSize: 12 }}>{key}</code>,
      title: 'Key',
      width: 220,
    },
    { dataIndex: 'label', key: 'label', title: 'Label', width: 180 },
    {
      dataIndex: 'description',
      key: 'description',
      render: (desc) =>
        desc ? (
          <Tooltip title={desc}>
            <InfoIcon size={14} style={{ cursor: 'help', opacity: 0.6 }} />
          </Tooltip>
        ) : null,
      title: '',
      width: 40,
    },
    {
      dataIndex: 'defaultEnabled',
      key: 'defaultEnabled',
      render: (v) => <Tag color={v ? 'green' : 'default'}>{v ? 'Enabled' : 'Disabled'}</Tag>,
      title: 'Default',
      width: 100,
    },
    {
      key: 'overrides',
      render: (_, row) => (
        <Flexbox gap={4} horizontal>
          {row.enabledUserIds?.length > 0 && (
            <Tag color="green">+{row.enabledUserIds.length} enabled</Tag>
          )}
          {row.disabledUserIds?.length > 0 && (
            <Tag color="red">-{row.disabledUserIds.length} disabled</Tag>
          )}
        </Flexbox>
      ),
      title: 'User Overrides',
      width: 180,
    },
    {
      key: 'actions',
      render: (_, row) => (
        <Flexbox gap={8} horizontal>
          <Button
            icon={<PencilIcon size={14} />}
            size="small"
            type="text"
            onClick={() => openEdit(row)}
          />
          <Button
            danger
            icon={<Trash2Icon size={14} />}
            size="small"
            type="text"
            onClick={() => {
              Modal.confirm({
                content: `Delete flag "${row.key}"?`,
                okButtonProps: { danger: true },
                okText: 'Delete',
                onOk: () => deleteMutation.mutate({ key: row.key }),
                title: 'Confirm Delete',
              });
            }}
          />
        </Flexbox>
      ),
      title: 'Actions',
      width: 100,
    },
  ];

  const headingStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--lobe-color-text, #000)',
  };

  return (
    <div>
      <Flexbox align="center" horizontal justify="space-between">
        <div style={headingStyle}>Feature Flags</div>
        <Button icon={<PlusIcon size={14} />} type="primary" onClick={openCreate}>
          New Flag
        </Button>
      </Flexbox>

      <div className={styles.tableWrap}>
        <Table
          columns={columns}
          dataSource={(flags ?? []) as FlagRow[]}
          loading={isLoading}
          pagination={false}
          rowKey="key"
          size="small"
        />
      </div>

      <Modal
        confirmLoading={upsertMutation.isPending}
        open={modalOpen}
        title={editing ? 'Edit Feature Flag' : 'New Feature Flag'}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={handleSubmit}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="Key"
            name="key"
            rules={[{ required: true, message: 'Key is required' }]}
          >
            <Input disabled={!!editing} placeholder="e.g. enable_audio_generation" />
          </Form.Item>
          <Form.Item
            label="Label"
            name="label"
            rules={[{ required: true, message: 'Label is required' }]}
          >
            <Input placeholder="Human-readable name" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea placeholder="What does this flag control?" rows={2} />
          </Form.Item>
          <Form.Item label="Enabled by default" name="defaultEnabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});

AdminFeatureFlags.displayName = 'AdminFeatureFlags';

export default AdminFeatureFlags;
