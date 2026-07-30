'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Switch, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

export const PlatformAdminPanel = () => {
  const { t } = useTranslation('aico');
  const [createForm] = Form.useForm<{ managerEmail: string; name: string }>();
  const [creditForm] = Form.useForm<{ amountToman: number; description?: string; orgId: string }>();
  const [assignForm] = Form.useForm<{
    managerEmail: string;
    orgId: string;
    role: 'owner' | 'admin';
  }>();
  const [trialForm] = Form.useForm<{
    allowedModelIds: string;
    durationDays: number;
    enabled: boolean;
    maxRequests?: number | null;
  }>();
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useClientDataSWR('aico-platform-orgs', () =>
    lambdaClient.platformAdmin.listOrganizations.query({ page: 1, pageSize: 50 }),
  );

  const { data: financials, mutate: mutateFinancials } = useClientDataSWR(
    'aico-platform-financials',
    () => lambdaClient.platformAdmin.getPlatformFinancials.query(),
  );
  const { data: master } = useClientDataSWR('aico-platform-master', () =>
    lambdaClient.platformAdmin.getMasterAccountStatus.query(),
  );
  const { data: trialConfig, mutate: mutateTrial } = useClientDataSWR('aico-trial-config', () =>
    lambdaClient.platformAdmin.getTrialConfig.query(),
  );
  const { data: userWallets } = useClientDataSWR('aico-user-wallets', () =>
    lambdaClient.platformAdmin.listUserWallets.query(),
  );

  useEffect(() => {
    if (trialConfig) {
      trialForm.setFieldsValue({
        allowedModelIds: (trialConfig.allowedModelIds || []).join(', '),
        durationDays: trialConfig.durationDays,
        enabled: trialConfig.enabled,
        maxRequests: trialConfig.maxRequests,
      });
    }
  }, [trialConfig, trialForm]);

  if (error) {
    return (
      <Flexbox className={styles.card} gap={8}>
        <Text strong>{t('platform.forbiddenTitle')}</Text>
        <Text type="secondary">{t('platform.forbiddenDesc')}</Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24}>
      <Flexbox gap={8}>
        <Text strong as="h1" style={{ fontSize: 20, margin: 0 }}>
          {t('platform.title')}
        </Text>
        <Text type="secondary">{t('platform.subtitle')}</Text>
      </Flexbox>

      <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 200 }}>
          <Text type="secondary">{t('platform.revenue')}</Text>
          <Text strong>{financials?.totalRevenueToman ?? '0'} تومان</Text>
        </Flexbox>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 200 }}>
          <Text type="secondary">{t('platform.usdCredited')}</Text>
          <Text strong>${financials?.totalUsdCredited ?? '0'}</Text>
        </Flexbox>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 200 }}>
          <Text type="secondary">{t('platform.b2cWallets')}</Text>
          <Text strong>
            {financials?.b2cWalletCount ?? 0} / ${financials?.b2cBalanceUsd ?? '0'}
          </Text>
        </Flexbox>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 200 }}>
          <Text type="secondary">{t('platform.openRouter')}</Text>
          <Text strong>${master?.balanceUsd ?? '0'}</Text>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('platform.trialTitle')}</Text>
        <Form
          form={trialForm}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              const allowedModelIds = (values.allowedModelIds || '')
                .split(/[,\n]/)
                .map((s: string) => s.trim())
                .filter(Boolean);
              await lambdaClient.platformAdmin.updateTrialConfig.mutate({
                allowedModelIds,
                durationDays: values.durationDays,
                enabled: values.enabled,
                maxRequests: values.maxRequests ?? null,
              });
              message.success(t('platform.trialSaved'));
              await mutateTrial();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('platform.trialFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label={t('platform.trialEnabled')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label={t('platform.trialDays')}
            name="durationDays"
            rules={[{ required: true }]}
          >
            <InputNumber max={90} min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('platform.trialMaxRequests')} name="maxRequests">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('platform.trialModels')} name="allowedModelIds">
            <Input.TextArea placeholder="openai/gpt-4o-mini (empty = all)" rows={2} />
          </Form.Item>
          <Button htmlType="submit" loading={busy} type="primary">
            {t('platform.trialSave')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('platform.createOrg')}</Text>
        <Form
          form={createForm}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              await lambdaClient.platformAdmin.createOrganization.mutate(values);
              message.success(t('platform.created'));
              createForm.resetFields();
              await mutate();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('platform.createFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label={t('platform.orgName')} name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label={t('platform.managerEmail')}
            name="managerEmail"
            rules={[{ required: true, type: 'email' }]}
          >
            <Input />
          </Form.Item>
          <Button htmlType="submit" loading={busy} type="primary">
            {t('platform.createSubmit')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('platform.assignManager')}</Text>
        <Form
          form={assignForm}
          initialValues={{ role: 'admin' }}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              await lambdaClient.platformAdmin.assignManager.mutate(values);
              message.success(t('platform.assigned'));
              await mutate();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('platform.assignFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label={t('platform.orgId')} name="orgId" rules={[{ required: true }]}>
            <Select
              options={(data?.items || []).map((o) => ({ label: o.name, value: o.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            label={t('platform.managerEmail')}
            name="managerEmail"
            rules={[{ required: true, type: 'email' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label={t('platform.managerRole')} name="role">
            <Select
              options={[
                { label: 'owner', value: 'owner' },
                { label: 'admin', value: 'admin' },
              ]}
            />
          </Form.Item>
          <Button htmlType="submit" loading={busy} type="primary">
            {t('platform.assignSubmit')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('platform.manualCredit')}</Text>
        <Form
          form={creditForm}
          layout="vertical"
          onFinish={async (values) => {
            setBusy(true);
            try {
              await lambdaClient.platformAdmin.addManualCredit.mutate(values);
              message.success(t('platform.credited'));
              await Promise.all([mutate(), mutateFinancials()]);
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('platform.creditFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label={t('platform.orgId')} name="orgId" rules={[{ required: true }]}>
            <Select
              options={(data?.items || []).map((o) => ({ label: o.name, value: o.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            label={t('platform.amountToman')}
            name="amountToman"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label={t('platform.description')} name="description">
            <Input />
          </Form.Item>
          <Button htmlType="submit" loading={busy} type="primary">
            {t('platform.creditSubmit')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
        <Text strong>{t('platform.orgsTitle')}</Text>
        <Table
          dataSource={data?.items || []}
          loading={isLoading}
          pagination={false}
          rowKey="id"
          columns={[
            { dataIndex: 'name', title: t('platform.columns.name') },
            { dataIndex: 'slug', title: t('platform.columns.slug') },
            { dataIndex: 'status', title: t('platform.columns.status') },
            { dataIndex: 'memberCount', title: t('platform.columns.members') },
            { dataIndex: 'walletBalanceToman', title: t('platform.columns.wallet') },
            {
              dataIndex: 'walletBalanceUsd',
              title: t('platform.columns.walletUsd'),
              render: (v) => Number(v ?? 0).toFixed(2),
            },
            {
              key: 'actions',
              title: t('platform.columns.actions'),
              render: (_, row) => (
                <Flexbox horizontal gap={8}>
                  {row.status === 'active' ? (
                    <Button
                      size="small"
                      onClick={async () => {
                        await lambdaClient.platformAdmin.suspendOrganization.mutate({
                          orgId: row.id,
                        });
                        await mutate();
                      }}
                    >
                      {t('platform.suspend')}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      onClick={async () => {
                        await lambdaClient.platformAdmin.activateOrganization.mutate({
                          orgId: row.id,
                        });
                        await mutate();
                      }}
                    >
                      {t('platform.activate')}
                    </Button>
                  )}
                </Flexbox>
              ),
            },
          ]}
        />
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
        <Text strong>{t('platform.b2cTitle')}</Text>
        <Table
          dataSource={userWallets || []}
          pagination={false}
          rowKey="userId"
          columns={[
            { dataIndex: 'userId', title: t('platform.columns.userId') },
            { dataIndex: 'balanceToman', title: t('platform.columns.wallet') },
            {
              dataIndex: 'balanceUsd',
              title: t('platform.columns.walletUsd'),
              render: (v: number) => v.toFixed(4),
            },
            {
              dataIndex: 'hasManagedKey',
              title: t('platform.columns.key'),
              render: (v: boolean) => (v ? '✓' : '—'),
            },
          ]}
        />
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
        <Text strong>{t('platform.recentTx')}</Text>
        <Table
          dataSource={financials?.recentTransactions || []}
          pagination={false}
          rowKey="id"
          columns={[
            { dataIndex: 'type', title: t('wallet.columns.type') },
            { dataIndex: 'amountToman', title: t('wallet.columns.toman') },
            {
              dataIndex: 'amountUsd',
              title: t('wallet.columns.usd'),
              render: (v) => (v == null ? '—' : Number(v).toFixed(4)),
            },
            { dataIndex: 'orgId', title: 'Org' },
            { dataIndex: 'userId', title: 'User' },
            {
              dataIndex: 'createdAt',
              title: t('wallet.columns.date'),
              render: (v: string) => new Date(v).toLocaleString(),
            },
          ]}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default PlatformAdminPanel;
