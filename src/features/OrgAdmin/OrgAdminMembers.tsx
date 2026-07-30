'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { Button, Select } from '@lobehub/ui/base-ui';
import { Form, Input, InputNumber, Table } from 'antd';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import { message } from '@/components/AntdStaticMethods';
import { isValidIranianPhoneNumber } from '@/libs/better-auth/phone';
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

type InviteForm = {
  identifierType: 'email' | 'phone';
  identifierValue: string;
  role: 'admin' | 'member';
};

export const OrgAdminMembers = () => {
  const { t } = useTranslation('aico');
  const navigate = useNavigate();
  const { orgId: orgIdParam } = useParams<{ orgId?: string }>();
  const [selectedOrgId, setSelectedOrgId] = useState(orgIdParam || '');
  const [form] = Form.useForm<InviteForm>();
  const [teamForm] = Form.useForm<{ name: string }>();
  const [topupForm] = Form.useForm<{ amountToman: number }>();
  const [allocForm] = Form.useForm<{ amountUsd: number; orgMemberId: string }>();
  const [modelsForm] = Form.useForm<{ modelIds: string; teamId: string }>();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: mine, isLoading: loadingMine } = useClientDataSWR('aico-org-mine', () =>
    lambdaClient.organization.getMine.query(),
  );

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

  const handleInvite = async (values: InviteForm) => {
    if (!selectedOrgId) return;
    if (values.identifierType === 'phone' && !isValidIranianPhoneNumber(values.identifierValue)) {
      message.error(t('org.invite.invalidPhone'));
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
      message.success(t('org.invite.sent'));
      form.resetFields(['identifierValue']);
      await mutate();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('org.invite.failed'));
    } finally {
      setInviting(false);
    }
  };

  if (loadingMine) return <Text type="secondary">{t('org.loading')}</Text>;

  if (manageable.length === 0) {
    return (
      <Flexbox className={styles.card} gap={8}>
        <Text strong>{t('org.emptyTitle')}</Text>
        <Text type="secondary">{t('org.emptyDesc')}</Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={24}>
      <Flexbox gap={8}>
        <Text strong as="h1" style={{ fontSize: 20, margin: 0 }}>
          {t('org.title')}
        </Text>
        <Text type="secondary">{t('org.subtitle')}</Text>
      </Flexbox>

      <Flexbox horizontal gap={8} style={{ alignItems: 'center' }}>
        <Text>{t('org.selectOrg')}</Text>
        <Select
          options={manageable.map((o) => ({ label: `${o.name} (${o.myRole})`, value: o.id }))}
          style={{ minWidth: 260 }}
          value={selectedOrgId || undefined}
          onChange={(value) => {
            setSelectedOrgId(value);
            navigate(`/org/${value}/members`);
          }}
        />
      </Flexbox>

      <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 180 }}>
          <Text type="secondary">{t('org.walletToman')}</Text>
          <Text strong>{wallet?.balanceToman?.toLocaleString() ?? 0}</Text>
        </Flexbox>
        <Flexbox className={styles.card} gap={4} style={{ minWidth: 180 }}>
          <Text type="secondary">{t('org.walletUsd')}</Text>
          <Text strong>${Number(wallet?.balanceUsd ?? 0).toFixed(4)}</Text>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('org.topupTitle')}</Text>
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
              message.success(t('org.topupSuccess'));
              topupForm.resetFields();
              await mutateWallet();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('org.topupFailed'));
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

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('org.allocateTitle')}</Text>
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
              message.success(t('org.allocateSuccess'));
              allocForm.resetFields(['amountUsd']);
              await mutateWallet();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('org.allocateFailed'));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item label={t('org.member')} name="orgMemberId" rules={[{ required: true }]}>
            <Select
              style={{ width: '100%' }}
              options={(roster?.members || []).map((m) => ({
                label: `${m.userId} (${m.role})`,
                value: m.id,
              }))}
            />
          </Form.Item>
          <Form.Item label={t('org.amountUsd')} name="amountUsd" rules={[{ required: true }]}>
            <InputNumber min={0.01} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Button htmlType="submit" loading={busy} type="primary">
            {t('org.allocateSubmit')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('org.teamsTitle')}</Text>
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
              message.error(err instanceof Error ? err.message : t('org.teamFailed'));
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
            { dataIndex: 'slug', title: t('org.columns.slug') },
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
              message.success(t('org.modelsSaved'));
              await mutateTeams();
            } catch (err) {
              message.error(err instanceof Error ? err.message : t('org.modelsFailed'));
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
          <Form.Item label={t('org.modelIds')} name="modelIds" rules={[{ required: true }]}>
            <Input.TextArea placeholder="openai/gpt-4o, anthropic/claude-3.5-sonnet" rows={2} />
          </Form.Item>
          <Button htmlType="submit" loading={busy}>
            {t('org.saveModels')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={16}>
        <Text strong>{t('org.invite.title')}</Text>
        <Form
          form={form}
          initialValues={{ identifierType: 'email', role: 'member' }}
          layout="vertical"
          onFinish={(v) => void handleInvite(v)}
        >
          <Form.Item
            label={t('org.invite.type')}
            name="identifierType"
            rules={[{ required: true }]}
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
          >
            <Input placeholder={t('org.invite.valuePlaceholder')} />
          </Form.Item>
          <Form.Item label={t('org.invite.role')} name="role" rules={[{ required: true }]}>
            <Select
              options={[
                { label: t('org.role.admin'), value: 'admin' },
                { label: t('org.role.member'), value: 'member' },
              ]}
            />
          </Form.Item>
          <Button htmlType="submit" loading={inviting} type="primary">
            {t('org.invite.submit')}
          </Button>
        </Form>
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
        <Text strong>{t('org.membersTitle')}</Text>
        <Table
          dataSource={roster?.members || []}
          loading={loadingRoster}
          pagination={false}
          rowKey="id"
          columns={[
            { dataIndex: 'userId', title: t('org.columns.userId') },
            { dataIndex: 'role', title: t('org.columns.role') },
            { dataIndex: 'status', title: t('org.columns.status') },
            {
              key: 'team',
              title: t('org.columns.team'),
              render: (_, row) => (
                <Select
                  options={(teams || []).map((team) => ({ label: team.name, value: team.id }))}
                  placeholder={t('org.assignTeam')}
                  style={{ minWidth: 140 }}
                  onChange={async (teamId) => {
                    if (!selectedOrgId) return;
                    await lambdaClient.organization.assignMemberToTeam.mutate({
                      orgId: selectedOrgId,
                      orgMemberId: row.id,
                      teamId,
                    });
                    message.success(t('org.teamAssigned'));
                  }}
                />
              ),
            },
            {
              key: 'actions',
              title: t('org.columns.actions'),
              render: (_, row) =>
                row.role === 'owner' ? null : (
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
                        await mutate();
                      } catch (error) {
                        message.error(
                          error instanceof Error ? error.message : t('org.removeFailed'),
                        );
                      }
                    }}
                  >
                    {t('org.remove')}
                  </Button>
                ),
            },
          ]}
        />
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
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
            { dataIndex: 'status', title: t('org.columns.status') },
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

      <Text type="secondary">
        <Link to="/wallet">{t('org.linkWallet')}</Link>
        {' · '}
        <Link to="/platform">{t('org.linkPlatform')}</Link>
      </Text>
    </Flexbox>
  );
};

export default OrgAdminMembers;
