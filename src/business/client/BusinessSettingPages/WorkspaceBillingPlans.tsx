import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Map, ShieldCheck } from 'lucide-react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;
    background: ${cssVar.colorBgContainer};
  `,
  current: css`
    border-color: ${cssVar.colorPrimary};
    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 42%),
      ${cssVar.colorBgContainer};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;

    @media (width <= 900px) {
      grid-template-columns: 1fr;
    }
  `,
  hero: css`
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 26px;
    background:
      radial-gradient(circle at 0 0, ${cssVar.colorPrimaryBg} 0, transparent 44%),
      linear-gradient(135deg, ${cssVar.colorBgContainer} 0%, ${cssVar.colorFillQuaternary} 100%);
  `,
}));

export default function WorkspaceBillingPlans() {
  const workspace = useActiveWorkspace();
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';
  const { data, mutate } = useSWR(
    workspace ? ['business/workspace-plan', workspace.id] : null,
    () => lambdaClient.subscription.getWorkspacePlan.query({ workspaceId: workspace!.id }),
  );

  return (
    <Flexbox gap={18}>
      <Flexbox className={styles.hero} gap={12}>
        <Flexbox horizontal align="center" gap={10}>
          <Map size={24} />
          <Text as="h1" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            Тариф workspace
          </Text>
        </Flexbox>
        <Text type="secondary">
          План определяет внутренние лимиты workspace: участников, токены и доступные business
          возможности. Владельцы и super-admin могут менять план без внешнего SaaS-биллинга.
        </Text>
      </Flexbox>
      <div className={styles.grid}>
        {data?.plans.map((plan) => (
          <Flexbox
            className={`${styles.card} ${data.plan === plan.id ? styles.current : ''}`}
            gap={12}
            key={plan.id}
          >
            <Flexbox horizontal align="center" justify="space-between">
              <Text style={{ fontSize: 20 }} weight={700}>
                {plan.name}
              </Text>
              {data.plan === plan.id && <ShieldCheck size={20} />}
            </Flexbox>
            <Text type="secondary">
              Участники: {plan.limits.members === -1 ? 'Без лимита' : plan.limits.members}
            </Text>
            <Text type="secondary">
              Токены в месяц:{' '}
              {plan.limits.monthlyTokens === -1
                ? 'Без лимита'
                : plan.limits.monthlyTokens.toLocaleString()}
            </Text>
            <Button
              disabled={!canManage || data.plan === plan.id}
              size="small"
              type={data.plan === plan.id ? 'primary' : 'default'}
              onClick={async () => {
                if (!workspace) return;
                await lambdaClient.subscription.setWorkspacePlan.mutate({
                  plan: plan.id,
                  workspaceId: workspace.id,
                });
                await mutate();
              }}
            >
              {data.plan === plan.id
                ? 'Текущий тариф'
                : canManage
                  ? 'Назначить тариф'
                  : 'Только для владельца'}
            </Button>
          </Flexbox>
        ))}
      </div>
    </Flexbox>
  );
}
