import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Coins, PlusCircle } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 22px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;
    background: ${cssVar.colorBgContainer};
  `,
  hero: css`
    border-color: ${cssVar.colorPrimary};
    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 42%),
      ${cssVar.colorBgContainer};
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
}));

export default function WorkspaceBillingCredits() {
  const workspace = useActiveWorkspace();
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';
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
    <Flexbox gap={18} style={{ maxWidth: 760 }}>
      <Flexbox className={`${styles.card} ${styles.hero}`} gap={14}>
        <Flexbox horizontal align="center" gap={10}>
          <Coins size={24} />
          <Text as="h1" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            Кредиты workspace
          </Text>
        </Flexbox>
        <Text type="secondary">
          Общий баланс команды для Acensus AI. Пополнения видят владельцы и super-admin, участники
          используют доступный баланс в workspace-сценариях.
        </Text>
        <Text style={{ fontSize: 40, fontWeight: 800 }}>{data?.balance ?? 0}</Text>
      </Flexbox>
      {canManage ? (
        <Flexbox horizontal className={`${styles.card} ${styles.mobileStack}`} gap={8}>
          <Input placeholder="Сумма" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button icon={<PlusCircle size={16} />} type="primary" onClick={topUp}>
            Пополнить
          </Button>
        </Flexbox>
      ) : (
        <Flexbox className={styles.card}>
          <Text type="secondary">Пополнять баланс могут только владельцы workspace.</Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}
