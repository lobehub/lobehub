'use client';

import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { Form, InputNumber, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import StatisticCard from '@/components/StatisticCard';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  `,
  page: css`
    width: 100%;
    max-width: 960px;
  `,
  section: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

export const AicoWallet = () => {
  const { t } = useTranslation('aico');
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ amountToman: number }>();

  const { data: wallet, mutate: mutateWallet } = useClientDataSWR('aico-my-wallet', () =>
    lambdaClient.aicoBilling.getMyWallet.query(),
  );
  const { data: fx } = useClientDataSWR('aico-fx', () =>
    lambdaClient.aicoBilling.getFxRate.query(),
  );
  const { data: trial, mutate: mutateTrial } = useClientDataSWR('aico-my-trial', () =>
    lambdaClient.aicoBilling.getMyTrial.query(),
  );
  const { data: txs, mutate: mutateTxs } = useClientDataSWR('aico-my-txs', () =>
    lambdaClient.aicoBilling.getMyTransactions.query({ limit: 20 }),
  );
  const { data: providerStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );

  return (
    <Flexbox className={styles.page} gap={20}>
      <Flexbox gap={4}>
        <Flexbox horizontal align="center" gap={8}>
          <Text strong as="h1" style={{ fontSize: 22, margin: 0 }}>
            {t('wallet.title')}
          </Text>
          {wallet?.publicCode ? <Tag>{wallet.publicCode}</Tag> : null}
        </Flexbox>
        <Text type="secondary">{t('wallet.subtitle')}</Text>
      </Flexbox>

      <div className={styles.grid}>
        <StatisticCard
          statistic={{ value: `$${wallet?.balanceUsd?.toFixed(4) ?? '0'}` }}
          title={t('wallet.balanceUsd')}
        />
        <StatisticCard
          statistic={{ value: wallet?.balanceToman?.toLocaleString() ?? 0 }}
          title={t('wallet.balanceToman')}
        />
        <StatisticCard
          title={t('wallet.provider')}
          statistic={{
            description: wallet?.hasManagedKey
              ? t('wallet.keyProvisioned')
              : t('wallet.keyPending'),
            value: providerStatus?.brandName ?? 'Aico',
          }}
        />
      </div>

      <Block className={styles.section} variant="outlined">
        <Flexbox gap={16}>
          <Text strong>{t('wallet.mockTopup')}</Text>
          <Text type="secondary">
            {t('wallet.fxHint', { rate: fx?.tomanPerUsd?.toLocaleString() ?? '—' })}
            {fx?.source ? ` (${fx.source})` : ''}
          </Text>
          <Form
            form={form}
            layout="vertical"
            onFinish={async (values) => {
              setBusy(true);
              try {
                const result = await lambdaClient.aicoBilling.mockTopup.mutate(values);
                toast.success(
                  t('wallet.topupSuccess', {
                    toman: values.amountToman.toLocaleString(),
                    usd: result.amountUsd,
                  }),
                );
                form.resetFields();
                await Promise.all([mutateWallet(), mutateTxs()]);
              } catch (err) {
                toastAicoError(err, t, 'wallet.topupFailed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Form.Item
              label={t('wallet.amountToman')}
              name="amountToman"
              rules={[{ required: true }]}
            >
              <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Button htmlType="submit" loading={busy} type="primary">
              {t('wallet.topupSubmit')}
            </Button>
          </Form>
        </Flexbox>
      </Block>

      <Block className={styles.section} variant="outlined">
        <Flexbox gap={12}>
          <Text strong>{t('wallet.trialTitle')}</Text>
          {trial?.active ? (
            <Text>
              {t('wallet.trialActive', {
                date: trial.trial?.expiresAt
                  ? new Date(trial.trial.expiresAt).toLocaleString()
                  : '—',
              })}
            </Text>
          ) : trial?.trial ? (
            <Text type="secondary">{t('wallet.trialUsed')}</Text>
          ) : (
            <>
              <Text type="secondary">
                {t('wallet.trialDesc', { days: trial?.config.durationDays ?? 3 })}
              </Text>
              <Button
                disabled={!trial?.config.enabled}
                loading={busy}
                type="primary"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await lambdaClient.aicoBilling.activateTrial.mutate();
                    toast.success(t('wallet.trialActivated'));
                    await mutateTrial();
                  } catch (err) {
                    toastAicoError(err, t, 'wallet.trialFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('wallet.trialActivate')}
              </Button>
            </>
          )}
        </Flexbox>
      </Block>

      <Block className={styles.section} variant="outlined">
        <Flexbox gap={12}>
          <Text strong>{t('wallet.upgradeTitle')}</Text>
          <Text type="secondary">{t('wallet.upgradeDesc')}</Text>
          <Link to="/org">
            <Button>{t('wallet.linkOrg')}</Button>
          </Link>
        </Flexbox>
      </Block>

      <Block className={styles.section} variant="outlined">
        <Flexbox gap={12}>
          <Text strong>{t('wallet.transactions')}</Text>
          <Table
            dataSource={txs || []}
            pagination={false}
            rowKey="id"
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
                dataIndex: 'createdAt',
                title: t('wallet.columns.date'),
                render: (v: Date | string) => new Date(v).toLocaleString(),
              },
            ]}
          />
        </Flexbox>
      </Block>
    </Flexbox>
  );
};

export default AicoWallet;
