import { Flexbox, Text } from '@lobehub/ui';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../../hooks/useActiveWorkspace';

export default function BusinessPanelContent() {
  const workspace = useActiveWorkspace();
  const { data: plan } = useSWR(workspace ? ['business/panel-plan', workspace.id] : null, () =>
    lambdaClient.subscription.getWorkspacePlan.query({ workspaceId: workspace!.id }),
  );
  const { data: credits } = useSWR(
    workspace ? ['business/panel-credits', workspace.id] : null,
    () => lambdaClient.workspaceCredits.getBalance.query({ workspaceId: workspace!.id }),
  );

  if (!workspace) return null;

  return (
    <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
      <Text fontSize={12} type="secondary">
        Acensus B2B
      </Text>
      <Text fontSize={13}>Тариф: {plan?.plan ?? 'enterprise'}</Text>
      <Text fontSize={13}>Кредиты: {credits?.balance ?? 0}</Text>
    </Flexbox>
  );
}
