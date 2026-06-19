import { Flexbox, Text } from '@lobehub/ui';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceBillingUsage() {
  const workspace = useActiveWorkspace();
  const { data } = useSWR(workspace ? ['business/workspace-usage', workspace.id] : null, () =>
    lambdaClient.workspaceUsage.summary.query({ workspaceId: workspace!.id }),
  );
  const { data: quota } = useSWR(
    workspace ? ['business/workspace-quota', workspace.id] : null,
    () => lambdaClient.workspaceUsage.quotaStatus.query({ workspaceId: workspace!.id }),
  );

  return (
    <Flexbox gap={8}>
      <Text weight={600}>Использование</Text>
      <Text type="secondary">Метрики self-hosted workspace из локальной базы данных.</Text>
      <Flexbox gap={4}>
        <Text>Участники: {data?.members ?? 0}</Text>
        <Text>Сообщения: {data?.messages ?? 0}</Text>
        <Text>Токены: {data?.tokens ?? 0}</Text>
        <Text>Оценочная стоимость: {data?.cost ?? 0}</Text>
      </Flexbox>
      {quota && (
        <Flexbox gap={4}>
          <Text weight={600}>Лимиты тарифа: {quota.plan}</Text>
          <Text type={quota.exceeded.members ? 'danger' : 'secondary'}>
            Участники: {quota.used.members} /{' '}
            {quota.limits.members === -1 ? 'без лимита' : quota.limits.members}
          </Text>
          <Text type={quota.exceeded.monthlyTokens ? 'danger' : 'secondary'}>
            Токены за месяц: {quota.used.monthlyTokens} /{' '}
            {quota.limits.monthlyTokens === -1 ? 'без лимита' : quota.limits.monthlyTokens}
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}
