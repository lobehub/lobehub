'use client';

import { Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import {
  Bot,
  BrainCircuit,
  CreditCard,
  Database,
  Gauge,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actionCard: css`
    cursor: pointer;

    min-height: 118px;
    padding: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;

    background: ${cssVar.colorFillQuaternary};

    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      transform 0.18s ease;

    &:hover {
      transform: translateY(-1px);
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  card: css`
    padding: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;
    background: ${cssVar.colorBgContainer};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 1100px) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  hero: css`
    position: relative;

    overflow: hidden;

    padding: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 28px;

    background:
      radial-gradient(circle at top right, ${cssVar.colorPrimaryBg} 0, transparent 38%),
      linear-gradient(135deg, ${cssVar.colorBgContainer} 0%, ${cssVar.colorFillQuaternary} 100%);
  `,
  icon: css`
    display: grid;
    place-items: center;

    width: 36px;
    height: 36px;
    border-radius: 12px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  metric: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;
    background: ${cssVar.colorFillQuaternary};
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const formatNumber = (value: number | undefined) => (value ?? 0).toLocaleString('ru-RU');

const formatCredits = (value: number | undefined) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value ?? 0);

const roleLabel: Record<string, string> = {
  member: 'Участник',
  owner: 'Владелец',
  super_admin: 'Super-admin',
  viewer: 'Наблюдатель',
};

interface MetricCardProps {
  description: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  value: ReactNode;
}

const MetricCard = ({ description, icon, title, value }: MetricCardProps) => (
  <Flexbox className={styles.metric} gap={12}>
    <Flexbox horizontal align="center" justify="space-between">
      <Text type="secondary">{title}</Text>
      <div className={styles.icon}>{icon}</div>
    </Flexbox>
    <Text as="div" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.15 }}>
      {value}
    </Text>
    <Text className={styles.muted} style={{ fontSize: 13 }}>
      {description}
    </Text>
  </Flexbox>
);

interface ActionCardProps {
  description: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  title: ReactNode;
}

const ActionCard = ({ description, icon, onClick, title }: ActionCardProps) => (
  <Flexbox className={styles.actionCard} gap={12} onClick={onClick}>
    <div className={styles.icon}>{icon}</div>
    <Flexbox gap={4}>
      <Text weight={600}>{title}</Text>
      <Text className={styles.muted} style={{ fontSize: 13 }}>
        {description}
      </Text>
    </Flexbox>
  </Flexbox>
);

export default function WorkspaceHomeDashboard() {
  const navigate = useNavigate();
  const workspace = useActiveWorkspace();
  const members = useWorkspaceMembers();
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';

  const { data: plan } = useSWR(workspace ? ['business/workspace-plan', workspace.id] : null, () =>
    lambdaClient.subscription.getWorkspacePlan.query({ workspaceId: workspace!.id }),
  );
  const { data: usage } = useSWR(
    workspace ? ['business/workspace-usage', workspace.id] : null,
    () => lambdaClient.workspaceUsage.summary.query({ workspaceId: workspace!.id }),
  );
  const { data: quota } = useSWR(
    workspace ? ['business/workspace-quota', workspace.id] : null,
    () => lambdaClient.workspaceUsage.quotaStatus.query({ workspaceId: workspace!.id }),
  );
  const { data: credits } = useSWR(
    workspace ? ['business/workspace-credits', workspace.id] : null,
    () => lambdaClient.workspaceCredits.getBalance.query({ workspaceId: workspace!.id }),
  );
  const { data: invites = [] } = useSWR(
    workspace && canManage ? ['business/workspace-invitations', workspace.id] : null,
    () => lambdaClient.workspaceMember.listInvitations.query({ workspaceId: workspace!.id }),
  );

  if (!workspace) return null;

  const workspacePath = (path: string) => `/${workspace.slug}${path}`;
  const planId = plan?.plan;
  const currentPlan = plan?.plans.find((item) => item.id === planId)?.name ?? planId ?? 'Starter';
  const memberLimit = quota?.limits.members === -1 ? 'без лимита' : quota?.limits.members;
  const tokenLimit =
    quota?.limits.monthlyTokens === -1 ? 'без лимита' : quota?.limits.monthlyTokens;
  const tokenLimitLabel = typeof tokenLimit === 'number' ? formatNumber(tokenLimit) : tokenLimit;
  const checklist = [
    {
      done: members.length > 1,
      label: 'Пригласить команду',
      path: '/settings/members',
    },
    {
      done: Boolean(planId && planId !== 'starter'),
      label: 'Выбрать рабочий тариф',
      path: '/settings/plans',
    },
    {
      done: (credits?.balance ?? 0) > 0,
      label: 'Пополнить баланс workspace',
      path: '/settings/credits',
    },
    {
      done: (usage?.messages ?? 0) > 0,
      label: 'Запустить первый workspace chat',
      path: '/agent/inbox',
    },
  ];

  return (
    <Flexbox gap={20}>
      <Flexbox className={styles.hero} gap={24}>
        <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
          <Flexbox gap={10}>
            <Flexbox horizontal gap={8}>
              <Tag>{roleLabel[workspace.role ?? 'member'] ?? workspace.role}</Tag>
              <Tag color="blue">{currentPlan}</Tag>
            </Flexbox>
            <Text as="h1" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>
              {workspace.name}
            </Text>
            <Text className={styles.muted} style={{ fontSize: 15, maxWidth: 680 }}>
              {workspace.description ||
                'Командное пространство Acensus: общайтесь с AI, подключайте знания компании и контролируйте расходы workspace.'}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            {workspace.role === 'super_admin' && (
              <Button icon={<ShieldCheck />} onClick={() => navigate('/admin/business')}>
                Super-admin
              </Button>
            )}
            <Button
              icon={<MessageSquarePlus />}
              type="primary"
              onClick={() => navigate(workspacePath('/agent/inbox'))}
            >
              Начать чат
            </Button>
            <Button
              icon={<Settings />}
              onClick={() => navigate(workspacePath('/settings/general'))}
            >
              Настройки
            </Button>
          </Flexbox>
        </Flexbox>

        <div className={styles.grid}>
          <MetricCard
            description={memberLimit ? `Лимит тарифа: ${memberLimit}` : 'Команда workspace'}
            icon={<Users size={18} />}
            title="Участники"
            value={formatNumber(members.length)}
          />
          <MetricCard
            description={tokenLimitLabel ? `Лимит: ${tokenLimitLabel}` : 'За текущий период'}
            icon={<Gauge size={18} />}
            title="Токены"
            value={formatNumber(usage?.tokens)}
          />
          <MetricCard
            description="Командный баланс"
            icon={<CreditCard size={18} />}
            title="Кредиты"
            value={formatCredits(credits?.balance)}
          />
          <MetricCard
            icon={<Bot size={18} />}
            title="Сообщения"
            value={formatNumber(usage?.messages)}
            description={
              canManage ? `Ожидают приглашения: ${invites.length}` : 'Доступно владельцам'
            }
          />
        </div>
      </Flexbox>

      <div className={styles.grid}>
        <ActionCard
          description="Добавьте людей по email или скопируйте invite link."
          icon={<Users size={18} />}
          title="Пригласить участников"
          onClick={() => navigate(workspacePath('/settings/members'))}
        />
        <ActionCard
          description="Загрузите документы компании и используйте их в ответах AI."
          icon={<BrainCircuit size={18} />}
          title="Добавить знания"
          onClick={() => navigate(workspacePath('/resource/library'))}
        />
        <ActionCard
          description="Посмотрите расход токенов, сообщений и оценочную стоимость."
          icon={<Gauge size={18} />}
          title="Открыть usage"
          onClick={() => navigate(workspacePath('/settings/usage'))}
        />
        <ActionCard
          description="Проверьте модели Acensus AI и командные credentials."
          icon={<Database size={18} />}
          title="Настроить AI"
          onClick={() => navigate(workspacePath('/settings/provider'))}
        />
      </div>

      <Flexbox horizontal gap={16} style={{ alignItems: 'stretch' }}>
        <Flexbox className={styles.card} flex={1} gap={14}>
          <Flexbox gap={4}>
            <Text weight={700}>Старт workspace</Text>
            <Text className={styles.muted} style={{ fontSize: 13 }}>
              Минимальный набор действий, после которого команда получает полноценный B2B-flow.
            </Text>
          </Flexbox>
          <Flexbox gap={10}>
            {checklist.map((item) => (
              <Flexbox horizontal align="center" justify="space-between" key={item.label}>
                <Flexbox horizontal align="center" gap={10}>
                  <Tag color={item.done ? 'green' : 'default'}>
                    {item.done ? 'Готово' : 'Далее'}
                  </Tag>
                  <Text>{item.label}</Text>
                </Flexbox>
                <Button size="small" type="text" onClick={() => navigate(workspacePath(item.path))}>
                  Открыть
                </Button>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>

        <Flexbox className={styles.card} flex={1} gap={14}>
          <Flexbox gap={4}>
            <Text weight={700}>Состояние workspace</Text>
            <Text className={styles.muted} style={{ fontSize: 13 }}>
              Быстрая сводка для владельца и команды.
            </Text>
          </Flexbox>
          <Flexbox gap={10}>
            <Text>Тариф: {currentPlan}</Text>
            <Text>Оценочная стоимость: {formatCredits(usage?.cost)}</Text>
            <Text>Pending invites: {canManage ? invites.length : 'только владелец'}</Text>
            <Text type={quota?.exceeded.monthlyTokens ? 'danger' : 'secondary'}>
              Лимит токенов: {formatNumber(quota?.used.monthlyTokens)} /{' '}
              {tokenLimitLabel || 'не задан'}
            </Text>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
