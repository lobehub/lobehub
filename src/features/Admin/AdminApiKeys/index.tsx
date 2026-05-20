'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Badge, Button, Form, Input, Modal, Switch, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
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

type KeyRow = {
  id: string;
  service: string;
  label: string;
  keyValue: string;
  isActive: boolean;
  updatedAt: Date | null;
};

const AdminApiKeys = memo(() => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KeyRow | null>(null);
  const [showKey, setShowKey] = useState(false);

  const { data: keys, isLoading, refetch } = lambdaQuery.admin.listApiKeys.useQuery();

  const upsertMutation = lambdaQuery.admin.upsertApiKey.useMutation({
    onError: () => message.error('Failed to save API key'),
    onSuccess: () => {
      message.success('API key saved');
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      refetch();
    },
  });

  const toggleMutation = lambdaQuery.admin.toggleApiKey.useMutation({
    onError: () => message.error('Failed to toggle key'),
    onSuccess: () => {
      message.success('Updated');
      refetch();
    },
  });

  const deleteMutation = lambdaQuery.admin.deleteApiKey.useMutation({
    onError: () => message.error('Failed to delete key'),
    onSuccess: () => {
      message.success('Key deleted');
      refetch();
    },
  });

  const openCreate = () => {
    form.resetFields();
    setEditing(null);
    setShowKey(false);
    setModalOpen(true);
  };

  const openEdit = (key: KeyRow) => {
    setEditing(key);
    form.setFieldsValue({ service: key.service, label: key.label, keyValue: '', isActive: key.isActive });
    setShowKey(false);
    setModalOpen(true);
  };

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      upsertMutation.mutate(values);
    });
  };

  const columns: ColumnsType<KeyRow> = [
    {
      dataIndex: 'service',
      key: 'service',
      render: (v) => <code style={{ fontSize: 12 }}>{v}</code>,
      title: 'Service',
      width: 200,
    },
    { dataIndex: 'label', key: 'label', title: 'Label', width: 180 },
    {
      dataIndex: 'keyValue',
      key: 'keyValue',
      render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
      title: 'Key',
      width: 240,
    },
    {
      dataIndex: 'isActive',
      key: 'isActive',
      render: (v, row) => (
        <Switch
          checked={v}
          size="small"
          onChange={(checked) => toggleMutation.mutate({ service: row.service, isActive: checked })}
        />
      ),
      title: 'Active',
      width: 80,
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
                content: `Delete key for "${row.service}"?`,
                okButtonProps: { danger: true },
                okText: 'Delete',
                onOk: () => deleteMutation.mutate({ service: row.service }),
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
        <div>
          <div style={headingStyle}>API Key Management</div>
          <div style={{ fontSize: 13, color: 'var(--lobe-color-text-tertiary)', marginTop: 4 }}>
            Manage API keys for external services. Keys are partially masked for display.
          </div>
        </div>
        <Button icon={<PlusIcon size={14} />} type="primary" onClick={openCreate}>
          Add Key
        </Button>
      </Flexbox>

      <div className={styles.tableWrap}>
        <Table
          columns={columns}
          dataSource={(keys ?? []) as KeyRow[]}
          loading={isLoading}
          pagination={false}
          rowKey="service"
          size="small"
        />
      </div>

      <Modal
        confirmLoading={upsertMutation.isPending}
        open={modalOpen}
        title={editing ? 'Edit API Key' : 'Add API Key'}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={handleSubmit}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="Service"
            name="service"
            rules={[{ required: true, message: 'Service is required' }]}
          >
            <Input disabled={!!editing} placeholder="e.g. audio_generation" />
          </Form.Item>
          <Form.Item
            label="Label"
            name="label"
            rules={[{ required: true, message: 'Label is required' }]}
          >
            <Input placeholder="Human-readable name" />
          </Form.Item>
          <Form.Item
            label={editing ? 'New API Key (leave blank to keep current)' : 'API Key'}
            name="keyValue"
            rules={editing ? [] : [{ required: true, message: 'API key is required' }]}
          >
            <Input.Password placeholder="Enter API key value" />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
});

AdminApiKeys.displayName = 'AdminApiKeys';

export default AdminApiKeys;
