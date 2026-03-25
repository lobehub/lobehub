'use client';

import { Button } from '@lobehub/ui';
import { Form, Input, Modal } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';

type ModelAccessItem = { model: string; provider: string };

const TEXTAREA_ROWS = 8;

const parseAccessText = (value: string): ModelAccessItem[] => {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [provider = '', model = ''] = line.split('/').map((v) => v.trim());
      return { model, provider };
    })
    .filter((item) => item.model && item.provider);
};

const formatAccessText = (items: ModelAccessItem[] = []) =>
  items.map((item) => `${item.provider}/${item.model}`).join('\n');

const AdminUserModelAccessTable = memo(() => {
  const { t } = useTranslation('auth');
  const [form] = Form.useForm();
  const [editingUser, setEditingUser] = useState<{ email: string; id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, mutate } = useClientDataSWR('admin-user-quotas', () =>
    usageService.adminGetAllUserQuotas(),
  );

  const rows = useMemo(() => data || [], [data]);

  const columns = [
    { dataIndex: 'email', key: 'email', title: '邮箱' },
    {
      dataIndex: 'advancedModelAccess',
      key: 'advancedModelAccess',
      render: (value: ModelAccessItem[] | undefined) => value?.length || 0,
      title: t('usage.modelAccess.count'),
    },
    {
      key: 'action',
      render: (_: unknown, record: any) => (
        <Button
          size="small"
          onClick={() => {
            setEditingUser({ email: record.email, id: record.id });
            form.setFieldsValue({
              accessText: formatAccessText((record.advancedModelAccess || []) as ModelAccessItem[]),
            });
          }}
        >
          {t('usage.modelAccess.edit')}
        </Button>
      ),
      title: '',
    },
  ];

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await usageService.adminSetUserAdvancedModelAccess(
        editingUser!.id,
        parseAccessText(values.accessText || ''),
      );
      setEditingUser(null);
      await mutate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <InlineTable
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        rowKey="id"
        size="small"
      />
      <Modal
        confirmLoading={saving}
        open={!!editingUser}
        title={`${t('usage.modelAccess.title')} — ${editingUser?.email}`}
        onCancel={() => setEditingUser(null)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            extra={t('usage.modelAccess.format')}
            label={t('usage.modelAccess.field')}
            name="accessText"
          >
            <Input.TextArea placeholder="moonshot/kimi-k2.5" rows={TEXTAREA_ROWS} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

AdminUserModelAccessTable.displayName = 'AdminUserModelAccessTable';

export default AdminUserModelAccessTable;
