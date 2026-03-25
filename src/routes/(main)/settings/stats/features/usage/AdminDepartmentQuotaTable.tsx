'use client';

import { Button } from '@lobehub/ui';
import { DatePicker, Divider, Form, InputNumber, Modal } from 'antd';
import dayjs from 'dayjs';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import InlineTable from '@/components/InlineTable';
import { useClientDataSWR } from '@/libs/swr';
import { usageService } from '@/services/usage';
import { type UsageLog, type UsageRecordItem } from '@/types/usage/usageRecord';

import { GroupBy } from '../../types';
import UsageCards from './UsageCards';
import UsageTrends from './UsageTrends';

const groupRecordsByDay = (records: UsageRecordItem[]): UsageLog[] => {
  const map = new Map<string, UsageLog>();
  for (const r of records) {
    const day = dayjs(r.createdAt).format('YYYY-MM-DD');
    if (!map.has(day)) {
      map.set(day, {
        date: new Date(r.createdAt).getTime(),
        day,
        records: [],
        totalRequests: 0,
        totalSpend: 0,
        totalTokens: 0,
      });
    }
    const entry = map.get(day)!;
    entry.records.push(r);
    entry.totalSpend += r.spend;
    entry.totalTokens += r.totalTokens || 0;
    entry.totalRequests += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.date - b.date);
};

interface DeptDetailPanelProps {
  dateStrings?: string;
  department: string;
}

const DeptDetailPanel = memo<DeptDetailPanelProps>(({ department, dateStrings }) => {
  const { data, isLoading } = useClientDataSWR(
    `admin-dept-usage-${department}-${dateStrings}`,
    () => usageService.adminGetUsageByDepartmentDetail(department, dateStrings),
  );
  const logs = data ? groupRecordsByDay(data) : undefined;
  return (
    <>
      <UsageCards data={logs} groupBy={GroupBy.Model} isLoading={isLoading} />
      <UsageTrends data={logs} groupBy={GroupBy.Model} isLoading={isLoading} />
    </>
  );
});

DeptDetailPanel.displayName = 'DeptDetailPanel';

const AdminDepartmentQuotaTable = memo(() => {
  const { t } = useTranslation('auth');
  const [editingDept, setEditingDept] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [detailMonth, setDetailMonth] = useState<dayjs.Dayjs>(dayjs());
  const [detailMonthStr, setDetailMonthStr] = useState<string | undefined>();

  const { data, isLoading, mutate } = useClientDataSWR('admin-dept-quotas', () =>
    usageService.adminGetAllDepartmentQuotas(),
  );

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await usageService.adminSetDepartmentQuota(editingDept.department, {
        dailyCostLimit: values.dailyCostLimit ?? null,
        dailyTokenLimit: values.dailyTokenLimit ?? null,
        monthlyCostLimit: values.monthlyCostLimit ?? null,
        monthlyTokenLimit: values.monthlyTokenLimit ?? null,
      });
      setEditingDept(null);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { dataIndex: 'department', key: 'department', title: '部门' },
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
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="small"
            onClick={() => {
              setEditingDept(record);
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
          <Button
            size="small"
            type={selectedDept === record.department ? 'primary' : 'default'}
            onClick={() =>
              setSelectedDept(selectedDept === record.department ? null : record.department)
            }
          >
            {t('usage.quota.viewUsage')}
          </Button>
        </div>
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
        rowKey="department"
        size="small"
      />
      {selectedDept && (
        <>
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 12 }}>
            <span style={{ fontWeight: 500 }}>{selectedDept}</span>
            <DatePicker
              picker="month"
              size="small"
              value={detailMonth}
              onChange={(d, s) => {
                if (d) setDetailMonth(d);
                if (typeof s === 'string') setDetailMonthStr(s);
              }}
            />
          </div>
          <DeptDetailPanel dateStrings={detailMonthStr} department={selectedDept} />
        </>
      )}
      <Modal
        confirmLoading={saving}
        open={!!editingDept}
        title={`${t('usage.quota.setLimit')} — ${editingDept?.department}`}
        onCancel={() => setEditingDept(null)}
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

AdminDepartmentQuotaTable.displayName = 'AdminDepartmentQuotaTable';

export default AdminDepartmentQuotaTable;
