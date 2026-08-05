'use client';

import { BarList } from '@lobehub/charts';
import { Block, Flexbox, Tag, Text } from '@lobehub/ui';
import { Button, Select, Tabs, toast } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Building2Icon, CircleDollarSignIcon, UsersIcon, WalletIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { toastAicoError } from '@/business/client/resolveAicoErrorMessage';
import StatisticCard from '@/components/StatisticCard';
import { isValidIranianPhoneNumber } from '@/libs/better-auth/phone';
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
    max-width: 1100px;
  `,
  section: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

type InviteForm = {
  identifierType: 'email' | 'phone';
  identifierValue: string;
  role: 'admin' | 'member';
};

const usd = (n: number | undefined | null) => `$${Number(n ?? 0).toFixed(2)}`;

export const OrgAdminMembers = () => {
  const { t } = useTranslation('aico');
  const navigate = useNavigate();
  const { orgId: orgIdParam } = useParams<{ orgId?: string }>();
  const [selectedOrgId, setSelectedOrgId] = useState(orgIdParam || '');
  const [tab, setTab] = useState('overview');
  const [form] = Form.useForm<InviteForm>();
  const [teamForm] = Form.useForm<{ name: string }>();
  const [topupForm] = Form.useForm<{ amountToman: number }>();
  const [allocForm] = Form.useForm<{ amountUsd: number; orgMemberId: string }>();
  const [modelsForm] = Form.useForm<{ modelIds: string; teamId: string }>();
  const [upgradeForm] = Form.useForm<{ name: string }>();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  const {
    data: mine,
    isLoading: loadingMine,
    mutate: mutateMine,
  } = useClientDataSWR('aico-org-mine', () => lambdaClient.organization.getMine.query());

  const manageable = (mine || []).filter((o) => o.myRole === 'owner' || o.myRole === 'admin');

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

  const { data: dashboard, mutate: mutateDashboard } = useClientDataSWR(
    selectedOrgId ? ['aico-org-dashboard', selectedOrgId] : null,
    () => lambdaClient.organization.getDashboard.query({ orgId: selectedOrgId }),
  );

  const { data: fx } = useClientDataSWR('aico-fx', () =>
    lambdaClient.aicoBilling.getFxRate.query(),
  );

  const refreshAll = async () => {
    await Promise.all([mutate(), mutateWallet(), mutateTeams(), mutateDashboard()]);
  };

  const usageBars = useMemo(
    () =>
      (dashboard?.members || [])
        .filter((m) => m.limitUsd > 0 || m.usedUsd > 0)
        .map((m) => ({
          name: m.publicCode || m.userId.slice(0, 10),
          value: Number(m.usedUsd.toFixed(4)),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [dashboard?.members],
  );

  const handleInvite = async (values: InviteForm) => {
    if (!selectedOrgId) return;
    if (values.identifierType === 'phone' && !isValidIranianPhoneNumber(values.identifierValue)) {
      toast.error(t('org.invite.invalidPhone'));
      return;
    }
    setInviting(true);
    try {
      await lambdaClient.organization.inviteMember.mutate({
        identifierType: values.identifierType,
        identifierValue: values.identifierValue,
        orgId: selectedOrgId,
        role: values.role,
      });
      toast.success(t('org.invite.sent'));
      form.resetFields(['identifierValue']);
      await mutate();
    } catch (error) {
      toastAicoError(error, t, 'org.invite.failed');
    } finally {
      setInviting(false);
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
                  toastAicoError(err, t, 'org.upgradeFailed');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Form.Item label={t('org.companyName')} name="name" rules={[{ required: true }]}>
                <Input placeholder={t('org.companyNamePlaceholder')} />
              </Form.Item>
              <Button htmlType="submit" loading={busy} type="primary">
                {t('org.upgradeSubmit')}
              </Button>
            </Form>
            <Text fontSize={12} type="secondary">
              {t('org.upgradePhoneHint')}
            </Text>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  }

  const currentOrg = manageable.find((o) => o.id === selectedOrgId);

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
                navigate(`/org/${value}/members`);
              }}
            />
            {dashboard?.publicCode || currentOrg?.publicCode ? (
              <Tag>{dashboard?.publicCode || currentOrg?.publicCode}</Tag>
            ) : null}
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <div className={styles.grid}>
        <StatisticCard
          statistic={{ prefix: <WalletIcon size={16} />, value: usd(dashboard?.unallocatedUsd) }}
          title={t('org.stat.unallocated')}
        />
        <StatisticCard
          title={t('org.stat.allocated')}
          statistic={{
            prefix: <CircleDollarSignIcon size={16} />,
            value: usd(dashboard?.allocatedUsd),
          }}
        />
        <StatisticCard statistic={{ value: usd(dashboard?.usedUsd) }} title={t('org.stat.used')} />
        <StatisticCard
          statistic={{ prefix: <UsersIcon size={16} />, value: dashboard?.memberCount ?? 0 }}
          title={t('org.stat.members')}
        />
      </div>

      <Tabs
        activeKey={tab}
        items={[
          { key: 'overview', label: t('org.tabs.overview') },
          { key: 'members', label: t('org.tabs.members') },
          { key: 'teams', label: t('org.tabs.teams') },
          { key: 'wallet', label: t('org.tabs.wallet') },
        ]}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <Flexbox gap={16}>
          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.usageChart')}</Text>
              <Text type="secondary">{t('org.usageChartHint')}</Text>
              {usageBars.length > 0 ? (
                <BarList data={usageBars} valueFormatter={(v) => usd(v)} />
              ) : (
                <Text type="secondary">{t('org.usageEmpty')}</Text>
              )}
            </Flexbox>
          </Block>

          <Block className={styles.section} variant="outlined">
            <Flexbox gap={12}>
              <Text strong>{t('org.memberUsageTitle')}</Text>
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
                  { dataIndex: 'role', title: t('org.columns.role') },
                  {
                    dataIndex: 'teamName',
                    title: t('org.columns.team'),
                    render: (v: string | null) => v || t('org.unspecifiedTeam'),
                  },
                  {
                    dataIndex: 'limitUsd',
                    title: t('org.columns.limit'),
                    render: (v: number) => usd(v),
                  },
                  {
                    dataIndex: 'usedUsd',
                    title: t('org.columns.used'),
                    render: (v: number) => usd(v),
                  },
                  {
                    dataIndex: 'remainingUsd',
                    title: t('org.columns.remaining'),
                    render: (v: number) => usd(v),
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
                    />
                  </Form.Item>
                  <Form.Item
                    label={t('org.invite.value')}
                    name="identifierValue"
                    rules={[{ required: true }]}
                    style={{ flex: 1, minWidth: 220 }}
                  >
                    <Input placeholder={t('org.invite.valuePlaceholder')} />
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
                <Button htmlType="submit" loading={inviting} type="primary">
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
                form={allocForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedOrgId) return;
                  setBusy(true);
                  try {
                    await lambdaClient.organization.allocateMemberCredit.mutate({
                      amountUsd: values.amountUsd,
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
                      options={(roster?.members || []).map((m) => ({
                        label: `${(m as { publicCode?: string | null }).publicCode || m.userId} (${m.role})`,
                        value: m.id,
                      }))}
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
                <Button htmlType="submit" loading={busy} type="primary">
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
                  { dataIndex: 'role', title: t('org.columns.role') },
                  { dataIndex: 'status', title: t('org.columns.status') },
                  {
                    key: 'team',
                    title: t('org.columns.team'),
                    render: (_, row) => (
                      <Select
                        placeholder={t('org.assignTeam')}
                        style={{ minWidth: 140 }}
                        options={(teams || []).map((team) => ({
                          label: team.name,
                          value: team.id,
                        }))}
                        onChange={async (teamId) => {
                          if (!selectedOrgId) return;
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
                      row.role === 'owner' ? null : (
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
                    key: 'revoke',
                    title: t('org.columns.actions'),
                    render: (_, row) => (
                      <Button
                        size="small"
                        type="text"
                        onClick={async () => {
                          if (!selectedOrgId) return;
                          await lambdaClient.organization.revokeInvite.mutate({
                            inviteId: row.id,
                            orgId: selectedOrgId,
                          });
                          await mutate();
                        }}
                      >
                        {t('org.revoke')}
                      </Button>
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
                <Button htmlType="submit" loading={busy}>
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
                    render: (ids: string[]) => (ids?.length ? ids.join(', ') : t('org.allModels')),
                  },
                  {
                    key: 'actions',
                    title: t('org.columns.actions'),
                    render: (_, row) =>
                      row.isDefault ? null : (
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
                form={modelsForm}
                layout="vertical"
                onFinish={async (values) => {
                  if (!selectedOrgId) return;
                  const modelIds = values.modelIds
                    .split(/[,\n]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  setBusy(true);
                  try {
                    await lambdaClient.organization.setTeamModels.mutate({
                      modelIds,
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
                  />
                </Form.Item>
                <Form.Item label={t('org.modelIds')} name="modelIds">
                  <Input.TextArea
                    placeholder="openai/gpt-4o, anthropic/claude-3.5-sonnet"
                    rows={2}
                  />
                </Form.Item>
                <Button htmlType="submit" loading={busy}>
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
                <Text strong>{t('org.topupTitle')}</Text>
              </Flexbox>
              <Text type="secondary">
                {t('wallet.fxHint', {
                  rate: fx?.tomanPerUsd?.toLocaleString() ?? '—',
                })}
                {fx?.source ? ` (${fx.source})` : ''}
              </Text>
              <Text>
                {t('org.walletUsd')}: <Text strong>{usd(wallet?.balanceUsd)}</Text>
              </Text>
              <Form
                form={topupForm}
                layout="inline"
                onFinish={async (values) => {
                  if (!selectedOrgId) return;
                  setBusy(true);
                  try {
                    await lambdaClient.organization.mockOrgTopup.mutate({
                      amountToman: values.amountToman,
                      orgId: selectedOrgId,
                    });
                    toast.success(t('org.topupSuccess'));
                    topupForm.resetFields();
                    await refreshAll();
                  } catch (err) {
                    toastAicoError(err, t, 'org.topupFailed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Form.Item name="amountToman" rules={[{ required: true }]}>
                  <InputNumber min={1000} placeholder={t('org.amountToman')} />
                </Form.Item>
                <Button htmlType="submit" loading={busy} type="primary">
                  {t('org.topupSubmit')}
                </Button>
              </Form>
            </Flexbox>
          </Block>
        </Flexbox>
      )}

      <Text type="secondary">
        <Link to="/wallet">{t('org.linkWallet')}</Link>
      </Text>
    </Flexbox>
  );
};

export default OrgAdminMembers;
