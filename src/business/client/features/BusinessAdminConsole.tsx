'use client';

import { Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Building2, Coins, Gauge, ShieldCheck, Snowflake, UsersRound } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;
    background: ${cssVar.colorBgContainer};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;

    @media (width <= 920px) {
      grid-template-columns: 1fr;
    }
  `,
  hero: css`
    padding: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 28px;
    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 42%),
      linear-gradient(135deg, ${cssVar.colorBgContainer} 0%, ${cssVar.colorFillQuaternary} 100%);
  `,
  item: css`
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;
    background: ${cssVar.colorFillQuaternary};
  `,
  mobileStack: css`
    @media (width <= 720px) {
      flex-direction: column;
      align-items: stretch;

      > * {
        width: 100% !important;
      }
    }
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const planOptions = [
  { label: 'Starter', value: 'starter' },
  { label: 'Business', value: 'business' },
  { label: 'Enterprise', value: 'enterprise' },
];

const fmt = (value: number | undefined) => (value ?? 0).toLocaleString('ru-RU');

export default function BusinessAdminConsole() {
  const { data, error, mutate } = useSWR('business/admin/overview', () =>
    lambdaClient.businessAdmin.overview.query(),
  );
  const [personalUser, setPersonalUser] = useState('');
  const [personalAmount, setPersonalAmount] = useState('');
  const [workspaceAmount, setWorkspaceAmount] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const runAction = async (actionId: string, action: () => Promise<void>, successText: string) => {
    setBusyAction(actionId);
    setNotice(null);

    try {
      await action();
      setNotice({ text: successText, tone: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Операция не выполнена';
      setNotice({ text: message, tone: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const grantPersonal = async () => {
    const amount = Number(personalAmount);
    if (!personalUser.trim() || !Number.isFinite(amount) || amount <= 0) return;
    await runAction(
      'grant-personal',
      async () => {
        await lambdaClient.businessAdmin.grantPersonalCredits.mutate({
          amount,
          note: 'Выдано из super-admin console',
          user: personalUser.trim(),
        });
        setPersonalAmount('');
        setPersonalUser('');
        await mutate();
      },
      'Личные кредиты выданы',
    );
  };

  if (error) {
    return (
      <Flexbox className={styles.card} gap={10}>
        <Text weight={700}>Нет доступа к super-admin console</Text>
        <Text type="secondary">
          Эта страница доступна только пользователям с ролью super_admin.
        </Text>
      </Flexbox>
    );
  }

  if (!data) {
    return (
      <Flexbox className={styles.card} gap={10} style={{ maxWidth: 720, padding: 24 }}>
        <Text weight={700}>Загружаем Business Control Center…</Text>
        <Text type="secondary">Проверяем права super-admin и свежие B2B метрики.</Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={18} style={{ maxWidth: 1180, padding: 24 }}>
      <Flexbox className={styles.hero} gap={16}>
        <Flexbox horizontal align="center" gap={12}>
          <ShieldCheck size={28} />
          <Text as="h1" style={{ fontSize: 34, fontWeight: 900, margin: 0 }}>
            Super-admin: Business Control Center
          </Text>
        </Flexbox>
        <Text className={styles.muted}>
          Единая панель управления B2B: личные кредиты пользователей, тарифы workspace, командные
          балансы и freeze при рисках. Здесь нет плейсхолдеров — все действия идут в реальные tRPC
          API и меняют production-сущности.
        </Text>
        {notice && (
          <Text type={notice.tone === 'error' ? 'danger' : 'success'} weight={600}>
            {notice.text}
          </Text>
        )}
        <Flexbox horizontal className={styles.mobileStack} gap={12}>
          <Flexbox className={styles.card} flex={1} gap={6}>
            <Flexbox horizontal align="center" gap={8}>
              <UsersRound size={18} />
              <Text type="secondary">Пользователи</Text>
            </Flexbox>
            <Text style={{ fontSize: 30, fontWeight: 800 }}>{fmt(data?.totals.users)}</Text>
          </Flexbox>
          <Flexbox className={styles.card} flex={1} gap={6}>
            <Flexbox horizontal align="center" gap={8}>
              <Building2 size={18} />
              <Text type="secondary">Workspace</Text>
            </Flexbox>
            <Text style={{ fontSize: 30, fontWeight: 800 }}>{fmt(data?.totals.workspaces)}</Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>

      <Flexbox className={styles.card} gap={12}>
        <Flexbox horizontal align="center" gap={10}>
          <Coins size={20} />
          <Text weight={700}>Выдать личные кредиты</Text>
        </Flexbox>
        <Text className={styles.muted}>
          Личный аккаунт по умолчанию имеет 0 токенов. Укажите user id или email и сумму.
        </Text>
        <Flexbox horizontal className={styles.mobileStack} gap={8}>
          <Input
            placeholder="User id или email"
            value={personalUser}
            onChange={(e) => setPersonalUser(e.target.value)}
          />
          <Input
            placeholder="Сумма"
            style={{ width: 180 }}
            value={personalAmount}
            onChange={(e) => setPersonalAmount(e.target.value)}
          />
          <Button
            disabled={busyAction !== null}
            loading={busyAction === 'grant-personal'}
            type="primary"
            onClick={grantPersonal}
          >
            Выдать
          </Button>
        </Flexbox>
      </Flexbox>

      <div className={styles.grid}>
        <Flexbox className={styles.card} gap={12}>
          <Flexbox horizontal align="center" gap={10}>
            <UsersRound size={20} />
            <Text weight={700}>Последние пользователи</Text>
          </Flexbox>
          {data.users.length === 0 && <Text className={styles.muted}>Пользователей пока нет.</Text>}
          {data.users.map((user) => (
            <Flexbox className={styles.item} gap={8} key={user.id}>
              <Flexbox horizontal className={styles.mobileStack} gap={8} justify="space-between">
                <Flexbox gap={2}>
                  <Text weight={600}>
                    {user.fullName || user.username || user.email || user.id}
                  </Text>
                  <Text className={styles.muted} fontSize={12}>
                    {user.email || user.id}
                  </Text>
                </Flexbox>
                <Flexbox horizontal gap={6}>
                  {user.role && <Tag>{user.role}</Tag>}
                  <Tag color={user.personalCredits > 0 ? 'green' : 'default'}>
                    {fmt(user.personalCredits)} кредитов
                  </Tag>
                </Flexbox>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>

        <Flexbox className={styles.card} gap={12}>
          <Flexbox horizontal align="center" gap={10}>
            <Building2 size={20} />
            <Text weight={700}>Workspace управление</Text>
          </Flexbox>
          {data.workspaces.length === 0 && (
            <Text className={styles.muted}>Workspace пока нет.</Text>
          )}
          {data.workspaces.map((workspace) => (
            <Flexbox className={styles.item} gap={10} key={workspace.id}>
              <Flexbox horizontal className={styles.mobileStack} gap={8} justify="space-between">
                <Flexbox gap={2}>
                  <Text weight={700}>{workspace.name}</Text>
                  <Text className={styles.muted} fontSize={12}>
                    /{workspace.slug} · {workspace.id}
                  </Text>
                </Flexbox>
                <Flexbox horizontal gap={6}>
                  <Tag color={workspace.frozen ? 'red' : 'green'}>
                    {workspace.frozen ? 'Frozen' : 'Active'}
                  </Tag>
                  <Tag>{workspace.plan}</Tag>
                  <Tag>{fmt(workspace.creditBalance)} кредитов</Tag>
                </Flexbox>
              </Flexbox>
              <Flexbox horizontal className={styles.mobileStack} gap={8}>
                <Select
                  options={planOptions}
                  style={{ width: 150 }}
                  value={workspace.plan}
                  onChange={async (plan) => {
                    const actionId = `plan:${workspace.id}`;
                    await runAction(
                      actionId,
                      async () => {
                        await lambdaClient.businessAdmin.setWorkspacePlan.mutate({
                          plan: plan as 'starter' | 'business' | 'enterprise',
                          workspaceId: workspace.id,
                        });
                        await mutate();
                      },
                      `Тариф workspace ${workspace.name} обновлён`,
                    );
                  }}
                />
                <Input
                  placeholder="Кредиты"
                  style={{ width: 140 }}
                  value={workspaceAmount[workspace.id] ?? ''}
                  onChange={(e) =>
                    setWorkspaceAmount((prev) => ({ ...prev, [workspace.id]: e.target.value }))
                  }
                />
                <Button
                  disabled={busyAction !== null}
                  icon={<Gauge size={15} />}
                  loading={busyAction === `topup:${workspace.id}`}
                  onClick={async () => {
                    const amount = Number(workspaceAmount[workspace.id]);
                    if (!Number.isFinite(amount) || amount <= 0) return;
                    if (
                      !window.confirm(
                        `Пополнить ${workspace.name} на ${amount.toLocaleString('ru-RU')} кредитов?`,
                      )
                    ) {
                      return;
                    }
                    await runAction(
                      `topup:${workspace.id}`,
                      async () => {
                        await lambdaClient.businessAdmin.topUpWorkspaceCredits.mutate({
                          amount,
                          note: 'Пополнение из super-admin console',
                          workspaceId: workspace.id,
                        });
                        setWorkspaceAmount((prev) => ({ ...prev, [workspace.id]: '' }));
                        await mutate();
                      },
                      `Баланс workspace ${workspace.name} пополнен`,
                    );
                  }}
                >
                  Пополнить
                </Button>
                <Button
                  disabled={busyAction !== null}
                  icon={<Snowflake size={15} />}
                  loading={busyAction === `freeze:${workspace.id}`}
                  onClick={async () => {
                    const verb = workspace.frozen ? 'разморозить' : 'заморозить';
                    if (!window.confirm(`Точно ${verb} workspace ${workspace.name}?`)) return;
                    await runAction(
                      `freeze:${workspace.id}`,
                      async () => {
                        await lambdaClient.businessAdmin.setWorkspaceFrozen.mutate({
                          frozen: !workspace.frozen,
                          reason: !workspace.frozen ? 'Заморожено super-admin' : undefined,
                          workspaceId: workspace.id,
                        });
                        await mutate();
                      },
                      `Workspace ${workspace.name} ${workspace.frozen ? 'разморожен' : 'заморожен'}`,
                    );
                  }}
                >
                  {workspace.frozen ? 'Разморозить' : 'Freeze'}
                </Button>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </div>
    </Flexbox>
  );
}
