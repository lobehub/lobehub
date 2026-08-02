'use client';

import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, Select, Switch, Tabs } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Building2Icon, CircleDollarSignIcon, ShieldIcon, WalletIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import { message } from '@/components/AntdStaticMethods';
import StatisticCard from '@/components/StatisticCard';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  `,
  page: css`
    width: 100%;
    max-width: 1100px;
  `,
  section: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

const usd = (n: number | string | undefined | null) => `$${Number(n ?? 0).toFixed(2)}`;

export const PlatformAdminPanel = () => {
  const { t } = useTranslation('aico');
  const [tab, setTab] = useState('overview');
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
    trialBudgetUsd?: number;
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
        trialBudgetUsd: trialConfig.trialBudgetUsd,
      });
    }
  }, [trialConfig, trialForm]);

  if (error) {
    return (
      <Flexbox className={styles.page} gap={8}>
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={8}>
            <Text strong>{t('platform.forbiddenTitle')}</Text>
            <Text type="secondary">{t('platform.forbiddenDesc')}</Text>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.page} gap={20}>
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <ShieldIcon size={20} />
          <Text strong as="h1" style={{ fontSize: 22, margin: 0 }}>
            {t('platform.title')}
          </Text>
        </Flexbox>
        <Text type="secondary">{t('platform.subtitle')}</Text>
      </Flexbox>

      <div className={styles.grid}>
        <StatisticCard
          title={t('platform.revenue')}
          statistic={{
            prefix: <WalletIcon size={16} />,
            value: Number(financials?.totalRevenueToman ?? 0).toLocaleString(),
          }}
        />
        <StatisticCard
          title={t('platform.usdCredited')}
          statistic={{
            prefix: <CircleDollarSignIcon size={16} />,
            value: usd(financials?.totalUsdCredited),
          }}
        />
        <StatisticCard
          title={t('platform.b2cWallets')}
          statistic={{
            value: `${financials?.b2cWalletCount ?? 0} / ${usd(financials?.b2cBalanceUsd)}`,
          }}
        />
        <StatisticCard
          title={t('platform.openRouterUsage')}
          statistic={{
            value: usd(financials?.totalOpenRouterCostUsd ?? master?.totalObservedUsageUsd),
          }}
        />
      </div>

      <Tabs
        activeKey={tab}
        items={[
          { key: 'overview', label: t('platform.tabs.overview') },
          { key: 'orgs', label: t('platform.tabs.orgs') },
          { key: 'trial', label: t('platform.tabs.trial') },
          { key: 'wallets', label: t('platform.tabs.wallets') },
          { key: 'credits', label: t('platform.tabs.credits') },
        ]}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={12}>
            <Text strong>{t('platform.recentTx')}</Text>
            <Table
              dataSource={financials?.recentTransactions || []}
              pagination={{ pageSize: 15 }}
              rowKey="id"
              size="middle"
              columns={[
                { dataIndex: 'type', title: t('wallet.columns.type') },
                {
                  dataIndex: 'amountUsd',
                  title: t('wallet.columns.usd'),
                  render: (v) => (v == null ? '—' : Number(v).toFixed(4)),
                },
                {
                  dataIndex: 'amountToman',
                  title: t('wallet.columns.toman'),
                  render: (v: number) => v?.toLocaleString?.() ?? v,
                },
                {
                  dataIndex: 'orgId',
                  title: t('platform.columns.org'),
                  render: (v: string | null) => (v ? v.slice(0, 12) : '—'),
                },
                {
                  dataIndex: 'userId',
                  title: t('platform.columns.userId'),
                  render: (v: string | null) => (v ? v.slice(0, 12) : '—'),
                },
                {
                  dataIndex: 'createdAt',
                  title: t('wallet.columns.date'),
                  render: (v: string | Date) => new Date(v).toLocaleString(),
                },
              ]}
            />
          </Flexbox>
        </Block>
      )}

      {tab === 'orgs' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={16}>
              <Flexbox horizontal align="center" gap={8}>
                <Building2Icon size={18} />
                <Text strong>{t('platform.createOrg')}</Text>
              </Flexbox>
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
                    toastAicoError(err, t, 'platform.createFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
                  <Form.Item
                    label={t('platform.orgName')}
                    name="name"
                    rules={[{ required: true }]}
                    style={{ flex: 1, minWidth: 200 }}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    label={t('platform.managerEmail')}
                    name="managerEmail"
                    rules={[{ required: true, type: 'email' }]}
                    style={{ flex: 1, minWidth: 220 }}
                  >
                    <Input />
                  </Form.Item>
                </Flexbox>
                <Button htmlType="submit" loading={busy} type="primary">
                  {t('platform.createSubmit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={16}>
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
                    toastAicoError(err, t, 'platform.assignFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
                  <Form.Item
                    label={t('platform.orgId')}
                    name="orgId"
                    rules={[{ required: true }]}
                    style={{ minWidth: 200 }}
                  >
                    <Select
                      style={{ width: '100%' }}
                      options={(data?.items || []).map((o) => ({
                        label: `${o.name}${o.publicCode ? ` · ${o.publicCode}` : ''}`,
                        value: o.id,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('platform.managerEmail')}
                    name="managerEmail"
                    rules={[{ required: true, type: 'email' }]}
                    style={{ minWidth: 220 }}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    label={t('platform.managerRole')}
                    name="role"
                    style={{ minWidth: 140 }}
                  >
                    <Select
                      options={[
                        { label: 'owner', value: 'owner' },
                        { label: 'admin', value: 'admin' },
                      ]}
                    />
                  </Form.Item>
                </Flexbox>
                <Button htmlType="submit" loading={busy} type="primary">
                  {t('platform.assignSubmit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('platform.orgsTitle')}</Text>
              <Table
                dataSource={data?.items || []}
                loading={isLoading}
                pagination={false}
                rowKey="id"
                columns={[
                  {
                    dataIndex: 'publicCode',
                    title: t('platform.columns.publicId'),
                    render: (v: string) => (v ? <Tag>{v}</Tag> : '—'),
                  },
                  { dataIndex: 'name', title: t('platform.columns.name') },
                  {
                    dataIndex: 'status',
                    title: t('platform.columns.status'),
                    render: (v: string) => (
                      <Tag color={v === 'active' ? 'success' : 'warning'}>{v}</Tag>
                    ),
                  },
                  { dataIndex: 'memberCount', title: t('platform.columns.members') },
                  {
                    dataIndex: 'walletBalanceUsd',
                    title: t('platform.columns.walletUsd'),
                    render: (v) => usd(v),
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
          </Block>
        </Flexbox>
      )}

      {tab === 'trial' && (
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={16}>
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
                    trialBudgetUsd: values.trialBudgetUsd,
                  });
                  message.success(t('platform.trialSaved'));
                  await mutateTrial();
                } catch (err) {
                  toastAicoError(err, t, 'platform.trialFailed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Form.Item label={t('platform.trialEnabled')} name="enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
                <Form.Item
                  label={t('platform.trialDays')}
                  name="durationDays"
                  rules={[{ required: true }]}
                  style={{ minWidth: 160 }}
                >
                  <InputNumber max={90} min={1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label={t('platform.trialMaxRequests')}
                  name="maxRequests"
                  style={{ minWidth: 160 }}
                >
                  <InputNumber min={1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label={t('platform.trialBudgetUsd')}
                  name="trialBudgetUsd"
                  style={{ minWidth: 160 }}
                >
                  <InputNumber min={0.01} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              </Flexbox>
              <Form.Item label={t('platform.trialModels')} name="allowedModelIds">
                <Input.TextArea placeholder="openai/gpt-4o-mini (empty = all)" rows={2} />
              </Form.Item>
              <Button htmlType="submit" loading={busy} type="primary">
                {t('platform.trialSave')}
              </Button>
            </Form>
          </Flexbox>
        </Block>
      )}

      {tab === 'wallets' && (
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={12}>
            <Text strong>{t('platform.b2cTitle')}</Text>
            <Table
              dataSource={userWallets || []}
              pagination={{ pageSize: 20 }}
              rowKey="userId"
              columns={[
                {
                  dataIndex: 'publicCode',
                  title: t('platform.columns.publicId'),
                  render: (v: string | null) => (v ? <Tag>{v}</Tag> : '—'),
                },
                {
                  dataIndex: 'userId',
                  title: t('platform.columns.userId'),
                  render: (v: string) => v.slice(0, 14),
                },
                {
                  dataIndex: 'balanceUsd',
                  title: t('platform.columns.walletUsd'),
                  render: (v: number) => usd(v),
                },
                {
                  dataIndex: 'hasManagedKey',
                  title: t('platform.columns.key'),
                  render: (v: boolean) => (v ? '✓' : '—'),
                },
              ]}
            />
          </Flexbox>
        </Block>
      )}

      {tab === 'credits' && (
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={16}>
            <Text strong>{t('platform.manualCredit')}</Text>
            <Text type="secondary">{t('platform.manualCreditHint')}</Text>
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
                  toastAicoError(err, t, 'platform.creditFailed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Form.Item label={t('platform.orgId')} name="orgId" rules={[{ required: true }]}>
                <Select
                  style={{ width: '100%' }}
                  options={(data?.items || []).map((o) => ({
                    label: `${o.name}${o.publicCode ? ` · ${o.publicCode}` : ''}`,
                    value: o.id,
                  }))}
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
        </Block>
      )}
    </Flexbox>
  );
};

export default PlatformAdminPanel;
