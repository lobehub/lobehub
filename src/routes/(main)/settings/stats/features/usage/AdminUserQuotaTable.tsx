'use client';

import { Button } from '@lobehub/ui';
import { Form, InputNumber, Modal } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';

const AdminUserQuotaTable = memo(() => {
  const { t } = useTranslation('auth');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const { data, isLoading, mutate } = useClientDataSWR('admin-user-quotas', () =>
    usageService.adminGetAllUserQuotas(),
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await usageService.adminSetUserQuota(editingUser.id, {
        dailyCostLimit: values.dailyCostLimit ?? null,
        dailyTokenLimit: values.dailyTokenLimit ?? null,
        monthlyCostLimit: values.monthlyCostLimit ?? null,
        monthlyTokenLimit: values.monthlyTokenLimit ?? null,
      });
      setEditingUser(null);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { dataIndex: 'email', key: 'email', title: '邮箱' },
    {
      dataIndex: 'interests',
      key: 'department',
      render: (v: string[]) => v?.[0] || '-',
      title: '部门',
    },
    {
      dataIndex: 'dailyCostLimit',
      key: 'dailyCostLimit',
      render: (v: number) => (v != null ? `$${v}` : t('usage.quota.noLimit')),
      title: t('usage.quota.dailyCost'),
    },
    {
      dataIndex: 'monthlyCostLimit',
      key: 'monthlyCostLimit',
      render: (v: number) => (v != null ? `$${v}` : t('usage.quota.noLimit')),
      title: t('usage.quota.monthlyCost'),
    },
    {
      dataIndex: 'dailyTokenLimit',
      key: 'dailyTokenLimit',
      render: (v: number) => (v != null ? v : t('usage.quota.noLimit')),
      title: t('usage.quota.dailyTokens'),
    },
    {
      dataIndex: 'monthlyTokenLimit',
      key: 'monthlyTokenLimit',
      render: (v: number) => (v != null ? v : t('usage.quota.noLimit')),
      title: t('usage.quota.monthlyTokens'),
    },
    {
      key: 'action',
      render: (_: any, record: any) => (
        <Button
          size="small"
          onClick={() => {
            setEditingUser(record);
            form.setFieldsValue({
              dailyCostLimit: record.dailyCostLimit,
              dailyTokenLimit: record.dailyTokenLimit,
              monthlyCostLimit: record.monthlyCostLimit,
              monthlyTokenLimit: record.monthlyTokenLimit,
            });
          }}
        >
          {t('usage.quota.setLimit')}
        </Button>
      ),
      title: '',
    },
  ];

  return (
    <>
      <InlineTable
        columns={columns}
        dataSource={data}
        loading={isLoading}
        rowKey="id"
        size="small"
      />
      <Modal
        confirmLoading={saving}
        open={!!editingUser}
        title={`${t('usage.quota.setLimit')} — ${editingUser?.email}`}
        onCancel={() => setEditingUser(null)}
        onOk={handleSave}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label={t('usage.quota.dailyCost')} name="dailyCostLimit">
            <InputNumber
              min={0}
              placeholder={t('usage.quota.noLimit')}
              precision={6}
              prefix="$"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label={t('usage.quota.monthlyCost')} name="monthlyCostLimit">
            <InputNumber
              min={0}
              placeholder={t('usage.quota.noLimit')}
              precision={6}
              prefix="$"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label={t('usage.quota.dailyTokens')} name="dailyTokenLimit">
            <InputNumber min={0} placeholder={t('usage.quota.noLimit')} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('usage.quota.monthlyTokens')} name="monthlyTokenLimit">
            <InputNumber min={0} placeholder={t('usage.quota.noLimit')} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
});

AdminUserQuotaTable.displayName = 'AdminUserQuotaTable';

export default AdminUserQuotaTable;
