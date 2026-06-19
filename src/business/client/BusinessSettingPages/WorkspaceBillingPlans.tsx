import { Button, Flexbox, Text } from '@lobehub/ui';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceBillingPlans() {
  const workspace = useActiveWorkspace();
  const { data, mutate } = useSWR(
    workspace ? ['business/workspace-plan', workspace.id] : null,
    () => lambdaClient.subscription.getWorkspacePlan.query({ workspaceId: workspace!.id }),
  );

  return (
    <Flexbox gap={16}>
      <Text weight={600}>Workspace plan</Text>
      <Text type="secondary">
        Plans are managed locally for in-house quotas and chargeback. No SaaS billing provider is
        required.
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
              Members: {plan.limits.members === -1 ? 'Unlimited' : plan.limits.members}
            </Text>
            <Text type="secondary">
              Monthly tokens:{' '}
              {plan.limits.monthlyTokens === -1
                ? 'Unlimited'
                : plan.limits.monthlyTokens.toLocaleString()}
            </Text>
            <Button
              disabled={data.plan === plan.id}
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
              {data.plan === plan.id ? 'Current plan' : 'Set plan'}
            </Button>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
}
