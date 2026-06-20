'use client';

import { Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Coins, ShieldCheck } from 'lucide-react';
import { memo, useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;
    background: ${cssVar.colorBgContainer};
  `,
  grant: css`
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
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const format = (value: number | undefined) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value ?? 0);

interface PersonalCreditLedgerItem {
  amount: number;
  at: string;
  note?: string;
  type: string;
}

const Credits = memo(() => {
  const [amount, setAmount] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [note, setNote] = useState('');
  const [granting, setGranting] = useState(false);
  const { data, mutate } = useSWR('business/personal-billing', () =>
    lambdaClient.personalBilling.get.query(),
  );

  const grant = async () => {
    const value = Number(amount);
    if (!targetUser.trim() || !Number.isFinite(value) || value <= 0) return;

    setGranting(true);
    try {
      await lambdaClient.personalBilling.grantCredits.mutate({
        amount: value,
        note: note.trim() || undefined,
        user: targetUser.trim(),
      });
      setAmount('');
      setNote('');
      setTargetUser('');
      await mutate();
    } finally {
      setGranting(false);
    }
  };

  return (
    <Flexbox gap={18} style={{ maxWidth: 860 }}>
      <Flexbox className={styles.card} gap={16}>
        <Flexbox horizontal align="center" gap={10}>
          <Coins size={24} />
          <Text as="h1" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            Личный баланс
          </Text>
        </Flexbox>
        <Text className={styles.muted}>
          По умолчанию у пользователя 0 токенов Acensus AI. Баланс выдается вручную super-admin и
          используется для личного окружения без workspace.
        </Text>
        <Flexbox horizontal align="center" gap={10}>
          <Text style={{ fontSize: 38, fontWeight: 800 }}>{format(data?.credits)}</Text>
          <Tag>{data?.currency ?? 'internal'}</Tag>
          <Tag color={(data?.credits ?? 0) > 0 ? 'green' : 'default'}>
            {(data?.credits ?? 0) > 0 ? 'Доступно' : '0 токенов'}
          </Tag>
        </Flexbox>
      </Flexbox>

      {data?.isSuperAdmin && (
        <Flexbox className={`${styles.card} ${styles.grant}`} gap={14}>
          <Flexbox horizontal align="center" gap={10}>
            <ShieldCheck size={22} />
            <Text weight={700}>Super-admin: выдать кредиты</Text>
          </Flexbox>
          <Text className={styles.muted}>
            Укажите user id или email. Начисление попадет в историю пользователя с вашим admin id.
          </Text>
          <Flexbox horizontal className={styles.mobileStack} gap={8}>
            <Input
              placeholder="User id или email"
              value={targetUser}
              onChange={(e) => setTargetUser(e.target.value)}
            />
            <Input
              placeholder="Сумма"
              style={{ width: 160 }}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button loading={granting} type="primary" onClick={grant}>
              Выдать
            </Button>
          </Flexbox>
          <Input
            placeholder="Комментарий для аудита"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Flexbox>
      )}

      <Flexbox className={styles.card} gap={12}>
        <Text weight={700}>История начислений</Text>
        {data?.ledger?.length ? (
          data.ledger
            .slice()
            .reverse()
            .map((item: PersonalCreditLedgerItem, index: number) => (
              <Flexbox
                horizontal
                align="center"
                className={styles.mobileStack}
                gap={12}
                justify="space-between"
                key={`${item.at}-${index}`}
              >
                <Flexbox gap={2}>
                  <Text>{item.type === 'admin_grant' ? 'Начисление super-admin' : item.type}</Text>
                  <Text className={styles.muted} fontSize={13}>
                    {new Date(item.at).toLocaleString('ru-RU')} · {item.note || 'без комментария'}
                  </Text>
                </Flexbox>
                <Tag color="green">+{format(item.amount)}</Tag>
              </Flexbox>
            ))
        ) : (
          <Flexbox gap={4} padding={16}>
            <Text weight={600}>Начислений пока нет</Text>
            <Text className={styles.muted}>
              Когда super-admin выдаст кредиты, они появятся здесь.
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

Credits.displayName = 'Credits';
export default Credits;
