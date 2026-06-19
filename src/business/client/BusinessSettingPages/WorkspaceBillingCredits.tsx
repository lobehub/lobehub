import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceBillingCredits() {
  const workspace = useActiveWorkspace();
  const [amount, setAmount] = useState('');
  const { data, mutate } = useSWR(
    workspace ? ['business/workspace-credits', workspace.id] : null,
    () => lambdaClient.workspaceCredits.getBalance.query({ workspaceId: workspace!.id }),
  );

  const topUp = async () => {
    if (!workspace) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    await lambdaClient.topUp.create.mutate({
      amount: value,
      note: 'Ручное внутреннее пополнение',
      workspaceId: workspace.id,
    });
    setAmount('');
    await mutate();
  };

  return (
    <Flexbox gap={16} style={{ maxWidth: 560 }}>
      <Text weight={600}>Кредиты</Text>
      <Text type="secondary">Кредиты управляются локально и не завязаны на SaaS-платежи.</Text>
      <Text>Баланс: {data?.balance ?? 0}</Text>
      <Flexbox horizontal gap={8}>
        <Input placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button type="primary" onClick={topUp}>
          Пополнить
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
