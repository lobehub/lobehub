'use client';

import { BarChart, BarList } from '@lobehub/charts';
import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, Select, Tabs, toast } from '@lobehub/ui/base-ui';
import { DatePicker, Form, Input, InputNumber, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import dayjs from 'dayjs';
import { Building2Icon, DollarSignIcon, UsersIcon, WalletIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import StatisticCard from '@/components/StatisticCard';
import {
  type FxTopupChargeField,
  FxTopupFields,
  type FxTopupFormValues,
} from '@/features/AicoBilling/FxTopupFields';
import { aicoPanelStyles } from '@/features/AicoPanels';
import { presentInviteLink } from '@/features/OrgAdmin/InviteLinkModal';
import { buildPhoneVerifyRedirectUrl, isValidIranianPhoneNumber } from '@/libs/better-auth/phone';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
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
  dangerCard: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorErrorBg};
  `,
  suspendedBanner: css`
    padding-block: 12px;
    padding-inline: 14px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorWarningBg};
  `,
}));

type InviteForm = {
  identifierType: 'email' | 'phone';
  identifierValue: string;
  role: 'admin' | 'member';
};

const usd = (n: number | string | undefined | null) => `$${Number(n ?? 0).toFixed(2)}`;

/** Default inclusive UTC window: last 30 calendar days including today. */
const defaultRange = (): [string, string] => {
  const to = dayjs().format('YYYY-MM-DD');
  const from = dayjs().subtract(29, 'day').format('YYYY-MM-DD');
  return [from, to];
};

export const OrgAdminMembers = () => {
  const { t } = useTranslation('aico');
  const navigate = useNavigate();
  const { orgId: orgIdParam } = useParams<{ orgId?: string }>();
  const [selectedOrgId, setSelectedOrgId] = useState(orgIdParam || '');
  const [tab, setTab] = useState('overview');
  const [[rangeFrom, rangeTo], setRange] = useState(defaultRange);
  const [chartMemberId, setChartMemberId] = useState<string>('all');
  const phoneVerified = useUserStore((s) =>
    Boolean(userProfileSelectors.userProfile(s)?.phoneNumberVerified),
  );
  const [form] = Form.useForm<InviteForm>();
  const inviteType = Form.useWatch('identifierType', form) ?? 'email';
  const [teamForm] = Form.useForm<{ name: string }>();
  const [topupForm] = Form.useForm<FxTopupFormValues>();
  const [topupChargeField, setTopupChargeField] = useState<FxTopupChargeField>('toman');
  const [allocForm] = Form.useForm<{ amountUsd: number; orgMemberId: string }>();
  const [modelsForm] = Form.useForm<{ modelIds: string[]; teamId: string }>();
  const [upgradeForm] = Form.useForm<{ name: string }>();
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  const {
    data: mine,
    isLoading: loadingMine,
    mutate: mutateMine,
  } = useClientDataSWR('aico-org-mine', () => lambdaClient.organization.getMine.query());

  const manageable = (mine || []).filter((o) => o.myRole === 'owner' || o.myRole === 'admin');
  const currentOrg = manageable.find((o) => o.id === selectedOrgId);
  const isOwner = currentOrg?.myRole === 'owner';
  const isSuspended = currentOrg?.status === 'suspended';
  const readOnly = isSuspended;

  useEffect(() => {
    if (!selectedOrgId && manageable[0]?.id) {
      setSelectedOrgId(manageable[0].id);
      navigate(`/org/${manageable[0].id}/members`, { replace: true });
    }
  }, [manageable, navigate, selectedOrgId]);

  const {
    data: roster,
    isLoading: loadingRoster,
    mutate,
  } = useClientDataSWR(selectedOrgId ? ['aico-org-members', selectedOrgId] : null, () =>
    lambdaClient.organization.listMembers.query({ orgId: selectedOrgId }),
  );

  const { data: wallet, mutate: mutateWallet } = useClientDataSWR(
    selectedOrgId ? ['aico-org-wallet', selectedOrgId] : null,
    () => lambdaClient.organization.getOrgWallet.query({ orgId: selectedOrgId }),
  );

  const { data: teams, mutate: mutateTeams } = useClientDataSWR(
    selectedOrgId ? ['aico-org-teams', selectedOrgId] : null,
    () => lambdaClient.organization.listTeams.query({ orgId: selectedOrgId }),
  );

  const { data: catalogModels } = useClientDataSWR('aico-org-model-catalog', () =>
    lambdaClient.aiModel.getAiProviderModelList.query({ id: 'openrouter', limit: 200 }),
  );

  const modelOptions = useMemo(
    () =>
      (catalogModels || []).map((model) => ({
        label: model.displayName ? `${model.displayName} (${model.id})` : model.id,
        value: model.id,
      })),
    [catalogModels],
  );

  const { data: dashboard, mutate: mutateDashboard } = useClientDataSWR(
    selectedOrgId ? ['aico-org-dashboard', selectedOrgId] : null,
    () => lambdaClient.organization.getDashboard.query({ orgId: selectedOrgId }),
  );

  const { data: fx } = useClientDataSWR('aico-fx', () =>
    lambdaClient.aicoBilling.getFxRate.query(),
  );

  const { data: usageChart, mutate: mutateUsageChart } = useClientDataSWR(
    selectedOrgId
      ? ['aico-org-usage-chart', selectedOrgId, rangeFrom, rangeTo, chartMemberId]
      : null,
    () =>
      chartMemberId === 'all'
        ? lambdaClient.organization.getOrgUsageChart.query({
            from: rangeFrom,
            orgId: selectedOrgId,
            to: rangeTo,
          })
        : lambdaClient.organization.getMemberUsageChart.query({
            from: rangeFrom,
            orgId: selectedOrgId,
            orgMemberId: chartMemberId,
            to: rangeTo,
          }),
  );

  const { data: txHistory, mutate: mutateTxHistory } = useClientDataSWR(
    selectedOrgId && tab === 'wallet'
      ? ['aico-org-tx-history', selectedOrgId, rangeFrom, rangeTo]
      : null,
    () =>
      lambdaClient.organization.getTransactionHistory.query({
        from: rangeFrom,
        orgId: selectedOrgId,
        to: rangeTo,
      }),
  );

  const refreshAll = async () => {
    await Promise.all([
      mutate(),
      mutateWallet(),
      mutateTeams(),
      mutateDashboard(),
      mutateUsageChart(),
      mutateTxHistory(),
    ]);
  };

  const spendCategory = t('org.usageSpend');
  const chartData = useMemo(
    () =>
      (usageChart || []).map((point) => ({
        date: point.date,
        [spendCategory]: Number(point.costUsd),
      })),
    [spendCategory, usageChart],
  );
  const hasChartSpend = useMemo(
    () => (usageChart || []).some((point) => Number(point.costMicroUsd) > 0),
    [usageChart],
  );

  const usageBars = useMemo(
    () =>
      (dashboard?.members || [])
        .filter((m) => Number(m.periodAmountUsd) > 0 || Number(m.settledUsageUsd) > 0)
        .map((m) => ({
          name: m.publicCode || m.userId.slice(0, 10),
          value: Number(Number(m.settledUsageUsd).toFixed(4)),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [dashboard?.members],
  );

  const rangePicker = (
    <Flexbox horizontal align="center" gap={12} wrap="wrap">
      <Text type="secondary">{t('org.usageRange')}</Text>
      <DatePicker.RangePicker
        allowClear={false}
        value={[dayjs(rangeFrom), dayjs(rangeTo)]}
        onChange={(values) => {
          if (!values?.[0] || !values[1]) return;
          setRange([values[0].format('YYYY-MM-DD'), values[1].format('YYYY-MM-DD')]);
        }}
      />
    </Flexbox>
  );

  const handleInvite = async (values: InviteForm) => {
    if (!selectedOrgId || readOnly) return;
    if (values.identifierType === 'phone' && !isValidIranianPhoneNumber(values.identifierValue)) {
      toast.error(t('org.invite.invalidPhone'));
      return;
    }
    setInviting(true);
    try {
      const result = await lambdaClient.organization.inviteMember.mutate({
        identifierType: values.identifierType,
        identifierValue: values.identifierValue,
        orgId: selectedOrgId,
        role: values.role,
      });
      // Modal is primary feedback (one-shot inviteUrl); listMembers never re-exposes the token.
      presentInviteLink(result.inviteUrl);
      form.resetFields(['identifierValue']);
      await mutate();
    } catch (error) {
      toastAicoError(error, t, 'org.invite.failed');
    } finally {
      setInviting(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!selectedOrgId) return;
    setBusy(true);
    try {
      await lambdaClient.organization.deleteOrganization.mutate({
        confirmName: deleteConfirmName,
        orgId: selectedOrgId,
      });
      toast.success(t('org.danger.deleted'));
      setDeleteConfirmName('');
      await mutateMine();
      navigate('/org', { replace: true });
    } catch (error) {
      toastAicoError(error, t, 'org.danger.failed');
    } finally {
      setBusy(false);
    }
  };

  if (loadingMine) return <Text type="secondary">{t('org.loading')}</Text>;

  if (manageable.length === 0) {
    return (
      <Flexbox className={styles.page} gap={16}>
        <Block className={styles.section} variant="outlined">
          <Flexbox gap={12}>
            <Flexbox gap={4}>
              <Text strong style={{ fontSize: 18 }}>
                {t('org.emptyTitle')}
              </Text>
              <Text type="secondary">{t('org.upgradeDesc')}</Text>
            </Flexbox>
            <Form
              form={upgradeForm}
              layout="vertical"
              onFinish={async (values) => {
                setBusy(true);
                try {
                  const org = await lambdaClient.organization.convertToManagement.mutate(values);
                  toast.success(t('org.upgradeSuccess', { code: org.publicCode }));
                  await mutateMine();
                  setSelectedOrgId(org.id);
                  navigate(`/org/${org.id}/members`);
                } catch (err) {
                  toastAicoError(err, t, 'org.upgradeFailed', {
                    phoneVerifyCallbackUrl: '/org',
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Form.Item label={t('org.companyName')} name="name" rules={[{ required: true }]}>
                <Input placeholder={t('org.companyNamePlaceholder')} />
              </Form.Item>
              {phoneVerified ? (
                <Button htmlType="submit" loading={busy} type="primary">
                  {t('org.upgradeSubmit')}
                </Button>
              ) : (
                <Flexbox gap={8}>
                  <Text fontSize={12} type="secondary">
                    {t('org.upgradePhoneHint')}
                  </Text>
                  <Button
                    type="primary"
                    onClick={() => {
                      window.location.assign(buildPhoneVerifyRedirectUrl('/org'));
                    }}
                  >
                    {t('org.verifyPhone')}
                  </Button>
                </Flexbox>
              )}
            </Form>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.page} gap={20}>
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Flexbox gap={4}>
            <Text strong as="h1" style={{ fontSize: 22, margin: 0 }}>
              {t('org.title')}
            </Text>
            <Text type="secondary">{t('org.subtitle')}</Text>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <Select
              style={{ minWidth: 240 }}
              value={selectedOrgId || undefined}
              options={manageable.map((o) => ({
                label: `${o.name}${o.publicCode ? ` · ${o.publicCode}` : ''}`,
                value: o.id,
              }))}
              onChange={(value) => {
                setSelectedOrgId(value);
                setDeleteConfirmName('');
                navigate(`/org/${value}/members`);
              }}
            />
            {isSuspended ? <Tag color="warning">{t('org.suspendedTag')}</Tag> : null}
            {dashboard?.publicCode || currentOrg?.publicCode ? (
              <Tag>{dashboard?.publicCode || currentOrg?.publicCode}</Tag>
            ) : null}
          </Flexbox>
        </Flexbox>
      </Flexbox>

      {isSuspended ? (
        <div className={styles.suspendedBanner}>
          <Text strong>{t('org.suspendedBanner')}</Text>
        </div>
      ) : null}

      <div className={styles.grid}>
        <StatisticCard
          statistic={{ prefix: <WalletIcon size={16} />, value: usd(dashboard?.unallocatedUsd) }}
          title={t('org.stat.unallocated')}
        />
        <StatisticCard
          title={t('org.stat.allocated')}
          statistic={{
            prefix: <DollarSignIcon size={16} />,
            value: usd(dashboard?.allocatedUsd),
          }}
        />
        <StatisticCard
          statistic={{ value: usd(dashboard?.settledUsageUsd) }}
          title={t('org.stat.used')}
        />
        <StatisticCard
          statistic={{ prefix: <UsersIcon size={16} />, value: dashboard?.memberCount ?? 0 }}
          title={t('org.stat.members')}
        />
      </div>

      <div className={aicoPanelStyles.tabs}>
        <Tabs
          activeKey={tab}
          items={[
            { key: 'overview', label: t('org.tabs.overview') },
            { key: 'members', label: t('org.tabs.members') },
            { key: 'teams', label: t('org.tabs.teams') },
            { key: 'wallet', label: t('org.tabs.wallet') },
            ...(isOwner ? [{ key: 'settings', label: t('org.tabs.settings') }] : []),
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'overview' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.usageChart')}</Text>
              <Text type="secondary">{t('org.usageChartHint')}</Text>
              {rangePicker}
              <Flexbox horizontal align="center" gap={12} wrap="wrap">
                <Text type="secondary">{t('org.usageMemberFilter')}</Text>
                <Select
                  style={{ minWidth: 220 }}
                  value={chartMemberId}
                  options={[
                    { label: t('org.usageMemberAll'), value: 'all' },
                    ...(dashboard?.members || []).map((m) => ({
                      label: m.email || m.username || m.publicCode || m.userId.slice(0, 12),
                      value: m.memberId,
                    })),
                  ]}
                  onChange={setChartMemberId}
                />
              </Flexbox>
              {hasChartSpend ? (
                <BarChart
                  categories={[spendCategory]}
                  data={chartData}
                  index="date"
                  valueFormatter={(v) => usd(v)}
                />
              ) : (
                <Text type="secondary">{t('org.usageEmpty')}</Text>
              )}
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.memberUsageTitle')}</Text>
              {usageBars.length > 0 ? (
                <BarList data={usageBars} valueFormatter={(v) => usd(v)} />
              ) : null}
              <Table
                dataSource={dashboard?.members || []}
                pagination={false}
                rowKey="memberId"
                size="middle"
                columns={[
                  {
                    dataIndex: 'publicCode',
                    title: t('org.columns.publicId'),
                    render: (v: string | null, row) => v || row.userId.slice(0, 12),
                  },
                  {
                    dataIndex: 'email',
                    title: t('org.columns.email'),
                    render: (v: string | null) => v || '—',
                  },
                  {
                    dataIndex: 'username',
                    title: t('org.columns.username'),
                    render: (v: string | null) => v || '—',
                  },
                  { dataIndex: 'role', title: t('org.columns.role') },
                  {
                    dataIndex: 'teamName',
                    title: t('org.columns.team'),
                    render: (v: string | null) => v || t('org.unspecifiedTeam'),
                  },
                  {
                    dataIndex: 'periodAmountUsd',
                    title: t('org.columns.limit'),
                    render: (v: string) => usd(v),
                  },
                  {
                    dataIndex: 'settledUsageUsd',
                    title: t('org.columns.used'),
                    render: (v: string) => usd(v),
                  },
                  {
                    dataIndex: 'remainingUsd',
                    title: t('org.columns.remaining'),
                    render: (v: string) => usd(v),
                  },
                ]}
              />
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      {tab === 'members' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={16}>
              <Text strong>{t('org.invite.title')}</Text>
              <Form
                disabled={readOnly}
                form={form}
                initialValues={{ identifierType: 'email', role: 'member' }}
                layout="vertical"
                onFinish={(v) => void handleInvite(v)}
              >
                <Flexbox horizontal gap={12} wrap="wrap">
                  <Form.Item
                    label={t('org.invite.type')}
                    name="identifierType"
                    rules={[{ required: true }]}
                    style={{ minWidth: 140 }}
                  >
                    <Select
                      options={[
                        { label: t('org.invite.email'), value: 'email' },
                        { label: t('org.invite.phone'), value: 'phone' },
                      ]}
                      onChange={() => {
                        form.setFieldValue('identifierValue', undefined);
                      }}
                    />
                  </Form.Item>
                  <Form.Item
                    name="identifierValue"
                    rules={[{ required: true }]}
                    style={{ flex: 1, minWidth: 220 }}
                    label={inviteType === 'phone' ? t('org.invite.phone') : t('org.invite.email')}
                  >
                    <Input
                      autoComplete={inviteType === 'phone' ? 'tel' : 'email'}
                      inputMode={inviteType === 'phone' ? 'tel' : 'email'}
                      type={inviteType === 'phone' ? 'tel' : 'email'}
                      placeholder={
                        inviteType === 'phone'
                          ? t('org.invite.phonePlaceholder')
                          : t('org.invite.emailPlaceholder')
                      }
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('org.invite.role')}
                    name="role"
                    rules={[{ required: true }]}
                    style={{ minWidth: 160 }}
                  >
                    <Select
                      options={[
                        { label: t('org.role.admin'), value: 'admin' },
                        { label: t('org.role.member'), value: 'member' },
                      ]}
                    />
                  </Form.Item>
                </Flexbox>
                <Button disabled={readOnly} htmlType="submit" loading={inviting} type="primary">
                  {t('org.invite.submit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.allocateTitle')}</Text>
              <Text type="secondary">{t('org.allocateHint')}</Text>
              <Form
                disabled={readOnly}
                form={allocForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedOrgId) return;
                  setBusy(true);
                  try {
                    await lambdaClient.organization.allocateMemberCredit.mutate({
                      amountUsd: Number(values.amountUsd).toFixed(6),
                      orgId: selectedOrgId,
                      orgMemberId: values.orgMemberId,
                    });
                    toast.success(t('org.allocateSuccess'));
                    allocForm.resetFields(['amountUsd']);
                    await refreshAll();
                  } catch (err) {
                    toastAicoError(err, t, 'org.allocateFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Flexbox horizontal gap={12} wrap="wrap">
                  <Form.Item
                    label={t('org.member')}
                    name="orgMemberId"
                    rules={[{ required: true }]}
                    style={{ flex: 1, minWidth: 220 }}
                  >
                    <Select
                      style={{ width: '100%' }}
                      options={(roster?.members || []).map((m) => {
                        const identity = m.email || m.username || m.publicCode || m.userId;
                        return {
                          label: `${identity} (${m.role})`,
                          value: m.id,
                        };
                      })}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('org.amountUsd')}
                    name="amountUsd"
                    rules={[{ required: true }]}
                    style={{ minWidth: 140 }}
                  >
                    <InputNumber min={0.01} step={0.5} style={{ width: '100%' }} />
                  </Form.Item>
                </Flexbox>
                <Button disabled={readOnly} htmlType="submit" loading={busy} type="primary">
                  {t('org.allocateSubmit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.membersTitle')}</Text>
              <Table
                dataSource={roster?.members || []}
                loading={loadingRoster}
                pagination={false}
                rowKey="id"
                columns={[
                  {
                    dataIndex: 'publicCode',
                    title: t('org.columns.publicId'),
                    render: (v: string | null, row) => v || row.userId.slice(0, 12),
                  },
                  {
                    dataIndex: 'email',
                    title: t('org.columns.email'),
                    render: (v: string | null) => v || '—',
                  },
                  {
                    dataIndex: 'username',
                    title: t('org.columns.username'),
                    render: (v: string | null) => v || '—',
                  },
                  { dataIndex: 'role', title: t('org.columns.role') },
                  { dataIndex: 'status', title: t('org.columns.status') },
                  {
                    key: 'team',
                    title: t('org.columns.team'),
                    render: (_, row) => (
                      <Select
                        disabled={readOnly}
                        placeholder={t('org.assignTeam')}
                        style={{ minWidth: 140 }}
                        options={(teams || []).map((team) => ({
                          label: team.name,
                          value: team.id,
                        }))}
                        onChange={async (teamId) => {
                          if (!selectedOrgId || readOnly) return;
                          await lambdaClient.organization.assignMemberToTeam.mutate({
                            orgId: selectedOrgId,
                            orgMemberId: row.id,
                            teamId,
                          });
                          toast.success(t('org.teamAssigned'));
                          await refreshAll();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    title: t('org.columns.actions'),
                    render: (_, row) =>
                      row.role === 'owner' || readOnly ? null : (
                        <Flexbox horizontal gap={4}>
                          <Button
                            size="small"
                            type="text"
                            onClick={async () => {
                              if (!selectedOrgId) return;
                              try {
                                const result =
                                  await lambdaClient.organization.revokeMemberBudget.mutate({
                                    orgId: selectedOrgId,
                                    orgMemberId: row.id,
                                  });
                                toast.success(
                                  t('org.reclaimSuccess', {
                                    usd: Number(result.reclaimedUsd).toFixed(2),
                                  }),
                                );
                                await refreshAll();
                              } catch (error) {
                                toastAicoError(error, t, 'org.reclaimFailed');
                              }
                            }}
                          >
                            {t('org.reclaim')}
                          </Button>
                          <Button
                            size="small"
                            type="text"
                            onClick={async () => {
                              if (!selectedOrgId) return;
                              try {
                                await lambdaClient.organization.removeMember.mutate({
                                  memberId: row.id,
                                  orgId: selectedOrgId,
                                });
                                toast.success(t('org.removeSuccess'));
                                await refreshAll();
                              } catch (error) {
                                toastAicoError(error, t, 'org.removeFailed');
                              }
                            }}
                          >
                            {t('org.remove')}
                          </Button>
                        </Flexbox>
                      ),
                  },
                ]}
              />
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.pendingInvites')}</Text>
              <Table
                dataSource={roster?.invites || []}
                loading={loadingRoster}
                pagination={false}
                rowKey="id"
                columns={[
                  { dataIndex: 'identifierType', title: t('org.columns.type') },
                  { dataIndex: 'identifierValue', title: t('org.columns.value') },
                  { dataIndex: 'role', title: t('org.columns.role') },
                  {
                    key: 'actions',
                    title: t('org.columns.actions'),
                    render: (_, row) => (
                      <Flexbox horizontal gap={4}>
                        <Button
                          size="small"
                          type="text"
                          onClick={async () => {
                            if (!selectedOrgId) return;
                            try {
                              const result = await lambdaClient.organization.getInviteLink.query({
                                inviteId: row.id,
                                orgId: selectedOrgId,
                              });
                              presentInviteLink(result.inviteUrl);
                            } catch (error) {
                              toastAicoError(error, t, 'org.invite.showLinkFailed');
                            }
                          }}
                        >
                          {t('org.invite.showLink')}
                        </Button>
                        <Button
                          disabled={readOnly}
                          size="small"
                          type="text"
                          onClick={async () => {
                            if (!selectedOrgId || readOnly) return;
                            await lambdaClient.organization.revokeInvite.mutate({
                              inviteId: row.id,
                              orgId: selectedOrgId,
                            });
                            await mutate();
                          }}
                        >
                          {t('org.revoke')}
                        </Button>
                      </Flexbox>
                    ),
                  },
                ]}
              />
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      {tab === 'teams' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={16}>
              <Text strong>{t('org.teamsTitle')}</Text>
              <Text type="secondary">{t('org.teamsHint')}</Text>
              <Form
                disabled={readOnly}
                form={teamForm}
                layout="inline"
                onFinish={async (values) => {
                  if (!selectedOrgId) return;
                  setBusy(true);
                  try {
                    await lambdaClient.organization.createTeam.mutate({
                      name: values.name,
                      orgId: selectedOrgId,
                    });
                    teamForm.resetFields();
                    await mutateTeams();
                  } catch (err) {
                    toastAicoError(err, t, 'org.teamFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Form.Item name="name" rules={[{ required: true }]}>
                  <Input placeholder={t('org.teamName')} />
                </Form.Item>
                <Button disabled={readOnly} htmlType="submit" loading={busy}>
                  {t('org.teamCreate')}
                </Button>
              </Form>
              <Table
                dataSource={teams || []}
                pagination={false}
                rowKey="id"
                columns={[
                  { dataIndex: 'name', title: t('org.columns.team') },
                  {
                    dataIndex: 'isDefault',
                    title: t('org.columns.default'),
                    render: (v: boolean) => (v ? '✓' : ''),
                  },
                  {
                    dataIndex: 'modelIds',
                    title: t('org.columns.models'),
                    render: (ids: string[]) =>
                      ids?.length ? (
                        <Flexbox horizontal gap={4} wrap="wrap">
                          {ids.map((id) => (
                            <Tag key={id}>{id}</Tag>
                          ))}
                        </Flexbox>
                      ) : (
                        t('org.noModelsGranted')
                      ),
                  },
                  {
                    key: 'actions',
                    title: t('org.columns.actions'),
                    render: (_, row) =>
                      row.isDefault || readOnly ? null : (
                        <Button
                          size="small"
                          type="text"
                          onClick={async () => {
                            if (!selectedOrgId) return;
                            await lambdaClient.organization.deleteTeam.mutate({
                              orgId: selectedOrgId,
                              teamId: row.id,
                            });
                            await mutateTeams();
                          }}
                        >
                          {t('org.delete')}
                        </Button>
                      ),
                  },
                ]}
              />
              <Form
                disabled={readOnly}
                form={modelsForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedOrgId || readOnly) return;
                  setBusy(true);
                  try {
                    await lambdaClient.organization.setTeamModels.mutate({
                      modelIds: values.modelIds || [],
                      orgId: selectedOrgId,
                      teamId: values.teamId,
                    });
                    toast.success(t('org.modelsSaved'));
                    await mutateTeams();
                  } catch (err) {
                    toastAicoError(err, t, 'org.modelsFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Form.Item label={t('org.team')} name="teamId" rules={[{ required: true }]}>
                  <Select
                    options={(teams || []).map((team) => ({ label: team.name, value: team.id }))}
                    style={{ width: '100%' }}
                    onChange={(teamId) => {
                      const team = (teams || []).find((item) => item.id === teamId);
                      modelsForm.setFieldValue('modelIds', team?.modelIds || []);
                    }}
                  />
                </Form.Item>
                <Form.Item label={t('org.modelIds')} name="modelIds">
                  <Select
                    allowClear
                    showSearch
                    mode="multiple"
                    options={modelOptions}
                    placeholder={t('org.modelIdsPlaceholder')}
                    style={{ width: '100%' }}
                    filterOption={(input, option) => {
                      const q = input.toLowerCase();
                      const label = String(option?.label ?? '').toLowerCase();
                      const value = String(option?.value ?? '').toLowerCase();
                      return label.includes(q) || value.includes(q);
                    }}
                  />
                </Form.Item>
                <Button disabled={readOnly} htmlType="submit" loading={busy}>
                  {t('org.saveModels')}
                </Button>
              </Form>
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      {tab === 'wallet' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={16}>
              <Flexbox horizontal align="center" gap={8}>
                <Building2Icon size={18} />
                <Text strong>{t('org.walletTitle')}</Text>
              </Flexbox>
              <Text>
                {t('org.walletUsd')}: <Text strong>{usd(wallet?.balanceUsd)}</Text>
              </Text>
              <Flexbox horizontal align="center" gap={8}>
                <Text strong>{t('org.onlineTopupTitle')}</Text>
                <Tag>{t('wallet.onlineTopupSoon')}</Tag>
              </Flexbox>
              <Text type="secondary">{t('org.onlineTopupDisabledHint')}</Text>
              <Text type="secondary">{t('org.walletManualHint')}</Text>
              <Form form={topupForm} layout="vertical">
                <FxTopupFields
                  disabled
                  chargeField={topupChargeField}
                  form={topupForm}
                  fxRate={fx?.tomanPerUsd}
                  fxSource={fx?.source}
                  tomanLabelKey="org.amountToman"
                  usdLabelKey="org.amountUsd"
                  onChargeFieldChange={setTopupChargeField}
                />
                <Button disabled type="primary">
                  {t('org.onlineTopupSubmit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.txTitle')}</Text>
              <Text type="secondary">{t('org.txHint')}</Text>
              {rangePicker}
              {(txHistory || []).length > 0 ? (
                <Table
                  dataSource={txHistory || []}
                  pagination={{ pageSize: 20 }}
                  rowKey="id"
                  size="middle"
                  columns={[
                    {
                      dataIndex: 'createdAt',
                      title: t('wallet.columns.date'),
                      render: (v: string) => new Date(v).toLocaleString(),
                    },
                    { dataIndex: 'type', title: t('wallet.columns.type') },
                    {
                      dataIndex: 'amountToman',
                      title: t('wallet.columns.toman'),
                      render: (v: string) => Number(v).toLocaleString(),
                    },
                    {
                      dataIndex: 'amountUsd',
                      title: t('wallet.columns.usd'),
                      render: (v: string) => usd(v),
                    },
                    {
                      dataIndex: 'description',
                      title: t('org.txDescription'),
                      render: (v: string | null) => v || '—',
                    },
                  ]}
                />
              ) : (
                <Text type="secondary">{t('org.txEmpty')}</Text>
              )}
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      {tab === 'settings' && isOwner && currentOrg && (
        <Flexbox gap={16}>
          <Flexbox className={styles.dangerCard} gap={12}>
            <Text strong>{t('org.danger.title')}</Text>
            <Text type="secondary">{t('org.danger.warning')}</Text>
            <Text type="secondary">{t('org.danger.confirmLabel')}</Text>
            <Input
              disabled={readOnly}
              placeholder={t('org.danger.confirmPlaceholder', { name: currentOrg.name })}
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
            />
            <Button
              danger
              disabled={readOnly || deleteConfirmName !== currentOrg.name}
              loading={busy}
              onClick={() => void handleDeleteOrganization()}
            >
              {t('org.danger.delete')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      <Text type="secondary">
        <Link to="/wallet">{t('org.linkWallet')}</Link>
      </Text>
    </Flexbox>
  );
};

export default OrgAdminMembers;
