'use client';

import { Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2, CircleGauge, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    position: relative;

    overflow: hidden;

    padding: 22px;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;

    @media (width <= 760px) {
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
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const formatLimit = (value: number) =>
  value === -1 ? 'Без лимита' : value.toLocaleString('ru-RU');

const Plans = memo(() => {
  const navigate = useNavigate();
  const { data } = useSWR('business/personal-billing', () =>
    lambdaClient.personalBilling.get.query(),
  );

  return (
    <Flexbox gap={18} style={{ maxWidth: 980 }}>
      <Flexbox className={styles.hero} gap={14}>
        <Flexbox horizontal align="center" gap={10}>
          <Sparkles size={22} />
          <Text as="h1" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            Личный тариф Acensus AI
          </Text>
        </Flexbox>
        <Text className={styles.muted}>
          Личный аккаунт по умолчанию стартует с 0 токенов. Super-admin может выдать баланс для
          персональных агентов, тестов и демо-сценариев без создания workspace.
        </Text>
        <Flexbox horizontal gap={8}>
          <Tag color={data?.plan === 'personal' ? 'green' : 'default'}>
            {data?.plan === 'personal' ? 'Баланс выдан' : '0 токенов по умолчанию'}
          </Tag>
          <Tag>Кредиты: {(data?.credits ?? 0).toLocaleString('ru-RU')}</Tag>
        </Flexbox>
      </Flexbox>

      <div className={styles.grid}>
        {data?.plans.map((plan) => {
          const isCurrent = plan.id === data.plan;
          return (
            <Flexbox
              className={`${styles.card} ${isCurrent ? styles.current : ''}`}
              gap={14}
              key={plan.id}
            >
              <Flexbox horizontal align="center" justify="space-between">
                <Flexbox gap={4}>
                  <Text style={{ fontSize: 20 }} weight={700}>
                    {plan.name}
                  </Text>
                  <Text className={styles.muted}>{plan.description}</Text>
                </Flexbox>
                {isCurrent ? <CheckCircle2 size={22} /> : <CircleGauge size={22} />}
              </Flexbox>
              <Flexbox gap={6}>
                <Text>Месячные токены: {formatLimit(plan.limits.monthlyTokens)}</Text>
                <Text>Workspace: {formatLimit(plan.limits.workspaces)}</Text>
              </Flexbox>
              <Button disabled={isCurrent} type={isCurrent ? 'primary' : 'default'}>
                {isCurrent ? 'Текущий тариф' : 'Назначается super-admin'}
              </Button>
            </Flexbox>
          );
        })}
      </div>

      <Button type="primary" onClick={() => navigate('/settings/credits')}>
        Открыть баланс и начисления
      </Button>
    </Flexbox>
  );
});

Plans.displayName = 'Plans';
export default Plans;
