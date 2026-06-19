import { Flexbox, Text } from '@lobehub/ui';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceBillingUsage() {
  const workspace = useActiveWorkspace();
  const { data } = useSWR(workspace ? ['business/workspace-usage', workspace.id] : null, () =>
    lambdaClient.workspaceUsage.summary.query({ workspaceId: workspace!.id }),
  );

  return (
    <Flexbox gap={8}>
      <Text weight={600}>Usage</Text>
      <Text type="secondary">Self-hosted workspace usage from the local database.</Text>
      <Flexbox gap={4}>
        <Text>Members: {data?.members ?? 0}</Text>
        <Text>Messages: {data?.messages ?? 0}</Text>
        <Text>Tokens: {data?.tokens ?? 0}</Text>
        <Text>Estimated cost: {data?.cost ?? 0}</Text>
      </Flexbox>
    </Flexbox>
  );
}
