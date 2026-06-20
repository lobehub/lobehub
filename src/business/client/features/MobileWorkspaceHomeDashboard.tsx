'use client';

import { ActionIcon, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { createStaticStyles } from 'antd-style';
import {
  Bot,
  BrainCircuit,
  CreditCard,
  Gauge,
  MessageSquarePlus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import useSWR from 'swr';

import MobileContentLayout from '@/components/server/MobileNavLayout';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useWorkspaceMembers } from '../hooks/useWorkspaceMembers';

const styles = createStaticStyles(({ css, cssVar }) => ({
  action: css`
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;
    background: ${cssVar.colorBgContainer};
  `,
  card: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 20px;
    background: ${cssVar.colorBgContainer};
  `,
  hero: css`
    padding: 18px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 24px;
    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 46%),
      linear-gradient(135deg, ${cssVar.colorBgContainer} 0%, ${cssVar.colorFillQuaternary} 100%);
  `,
  icon: css`
    display: grid;
    flex: none;
    place-items: center;

    width: 34px;
    height: 34px;
    border-radius: 12px;

    color: ${cssVar.colorPrimary};

    background: ${cssVar.colorPrimaryBg};
  `,
  metric: css`
    padding: 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;
    background: ${cssVar.colorFillQuaternary};
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
  page: css`
    padding-block: 12px 84px;
    padding-inline: 14px;
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

interface MetricProps {
  icon: ReactNode;
  label: ReactNode;
  value: ReactNode;
}

const Metric = ({ icon, label, value }: MetricProps) => (
  <Flexbox className={styles.metric} gap={8}>
    <Flexbox horizontal align="center" gap={8}>
      <div className={styles.icon}>{icon}</div>
      <Text className={styles.muted} style={{ fontSize: 13 }}>
        {label}
      </Text>
    </Flexbox>
    <Text style={{ fontSize: 22, fontWeight: 700 }}>{value}</Text>
  </Flexbox>
);

interface ActionProps {
  description: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  title: ReactNode;
}

const Action = ({ description, icon, onClick, title }: ActionProps) => (
  <Flexbox horizontal align="center" className={styles.action} gap={12} onClick={onClick}>
    <div className={styles.icon}>{icon}</div>
    <Flexbox flex={1} gap={2}>
      <Text weight={600}>{title}</Text>
      <Text className={styles.muted} style={{ fontSize: 13 }}>
        {description}
      </Text>
    </Flexbox>
  </Flexbox>
);

export default function MobileWorkspaceHomeDashboard() {
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
  const tokenLimit =
    quota?.limits.monthlyTokens === -1 ? 'без лимита' : quota?.limits.monthlyTokens;
  const tokenLimitLabel = typeof tokenLimit === 'number' ? formatNumber(tokenLimit) : tokenLimit;
  const checklist = [
    { done: members.length > 1, label: 'Пригласить команду', path: '/settings/members' },
    {
      done: Boolean(planId && planId !== 'starter'),
      label: 'Выбрать тариф',
      path: '/settings/plans',
    },
    { done: (credits?.balance ?? 0) > 0, label: 'Пополнить баланс', path: '/settings/credits' },
    { done: (usage?.messages ?? 0) > 0, label: 'Начать workspace chat', path: '/agent/inbox' },
  ];

  return (
    <MobileContentLayout
      withNav
      className={styles.page}
      header={
        <ChatHeader
          left={<Text weight={700}>Workspace</Text>}
          right={
            <ActionIcon
              icon={Settings}
              size={MOBILE_HEADER_ICON_SIZE}
              onClick={() => navigate(workspacePath('/settings/general'))}
            />
          }
        />
      }
    >
      <Flexbox gap={14}>
        <Flexbox className={styles.hero} gap={16}>
          <Flexbox gap={8}>
            <Flexbox horizontal gap={8}>
              <Tag>{roleLabel[workspace.role ?? 'member'] ?? workspace.role}</Tag>
              <Tag color="blue">{currentPlan}</Tag>
            </Flexbox>
            <Text as="h1" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.08, margin: 0 }}>
              {workspace.name}
            </Text>
            <Text className={styles.muted} style={{ fontSize: 14 }}>
              {workspace.description || 'Командный AI, знания и расходы workspace в одном месте.'}
            </Text>
          </Flexbox>
          <Button
            block
            icon={<MessageSquarePlus />}
            type="primary"
            onClick={() => navigate(workspacePath('/agent/inbox'))}
          >
            Начать workspace chat
          </Button>
          {workspace.role === 'super_admin' && (
            <Button block icon={<ShieldCheck />} onClick={() => navigate('/admin/business')}>
              Super-admin console
            </Button>
          )}
        </Flexbox>

        <Flexbox horizontal gap={10}>
          <Metric
            icon={<Users size={17} />}
            label="Участники"
            value={formatNumber(members.length)}
          />
          <Metric
            icon={<CreditCard size={17} />}
            label="Кредиты"
            value={formatCredits(credits?.balance)}
          />
        </Flexbox>
        <Flexbox horizontal gap={10}>
          <Metric icon={<Gauge size={17} />} label="Токены" value={formatNumber(usage?.tokens)} />
          <Metric
            icon={<Bot size={17} />}
            label="Сообщения"
            value={formatNumber(usage?.messages)}
          />
        </Flexbox>

        <Flexbox gap={10}>
          <Action
            description="Участники, роли и invite links"
            icon={<Users size={17} />}
            title="Команда"
            onClick={() => navigate(workspacePath('/settings/members'))}
          />
          <Action
            description="Расходы, токены и лимиты"
            icon={<Gauge size={17} />}
            title="Usage"
            onClick={() => navigate(workspacePath('/settings/usage'))}
          />
          <Action
            description="Модели Acensus AI и настройки"
            icon={<BrainCircuit size={17} />}
            title="AI настройки"
            onClick={() => navigate(workspacePath('/settings/provider'))}
          />
        </Flexbox>

        <Flexbox className={styles.card} gap={12}>
          <Flexbox gap={3}>
            <Text weight={700}>Быстрый старт</Text>
            <Text className={styles.muted} style={{ fontSize: 13 }}>
              То, что стоит сделать первым на телефоне.
            </Text>
          </Flexbox>
          {checklist.map((item) => (
            <Flexbox horizontal align="center" justify="space-between" key={item.label}>
              <Flexbox horizontal align="center" gap={8}>
                <Tag color={item.done ? 'green' : 'default'}>{item.done ? 'Готово' : 'Далее'}</Tag>
                <Text>{item.label}</Text>
              </Flexbox>
              <Button size="small" type="text" onClick={() => navigate(workspacePath(item.path))}>
                Открыть
              </Button>
            </Flexbox>
          ))}
        </Flexbox>

        <Flexbox className={styles.card} gap={8}>
          <Text weight={700}>Состояние</Text>
          <Text type="secondary">Тариф: {currentPlan}</Text>
          <Text type="secondary">
            Pending invites: {canManage ? invites.length : 'только владелец'}
          </Text>
          <Text type={quota?.exceeded.monthlyTokens ? 'danger' : 'secondary'}>
            Лимит токенов: {formatNumber(quota?.used.monthlyTokens)} /{' '}
            {tokenLimitLabel || 'не задан'}
          </Text>
        </Flexbox>
      </Flexbox>
    </MobileContentLayout>
  );
}
