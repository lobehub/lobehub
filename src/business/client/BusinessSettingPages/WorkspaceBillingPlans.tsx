import { Button, Flexbox, Text } from '@lobehub/ui';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceBillingPlans() {
  const workspace = useActiveWorkspace();
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';
  const { data, mutate } = useSWR(
    workspace ? ['business/workspace-plan', workspace.id] : null,
    () => lambdaClient.subscription.getWorkspacePlan.query({ workspaceId: workspace!.id }),
  );

  return (
    <Flexbox gap={16}>
      <Text weight={600}>Тариф workspace</Text>
      <Text type="secondary">
        Тарифы управляются локально для внутренних лимитов и chargeback. Внешний SaaS-биллинг не
        нужен.
      </Text>
      <Flexbox gap={8}>
        {data?.plans.map((plan) => (
          <Flexbox
            gap={8}
            key={plan.id}
            padding={16}
            style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 8 }}
          >
            <Text weight={600}>{plan.name}</Text>
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
      </Flexbox>
    </Flexbox>
  );
}
