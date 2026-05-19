'use client';

import { createStaticStyles } from 'antd-style';
import { BanIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react';
import { memo } from 'react';

import { Flexbox, Icon, Skeleton } from '@lobehub/ui';

import { lambdaQuery } from '@/libs/trpc/client';

const useStyles = createStaticStyles(({ css, token }) => ({
  card: css`
    flex: 1;
    min-width: 180px;
    padding: 20px 24px;
    border-radius: 12px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    box-shadow: ${token.boxShadowTertiary};
  `,
  cardIcon: css`
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  `,
  cardLabel: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin-bottom: 6px;
  `,
  cardValue: css`
    font-size: 28px;
    font-weight: 700;
    color: ${token.colorText};
    line-height: 1;
  `,
  heading: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
    margin-bottom: 4px;
  `,
  root: css`
    width: 100%;
  `,
  sub: css`
    font-size: 13px;
    color: ${token.colorTextTertiary};
    margin-bottom: 24px;
  `,
}));

interface StatCardProps {
  bg: string;
  color: string;
  icon: React.ElementType;
  label: string;
  loading?: boolean;
  value?: number;
}

const StatCard = memo<StatCardProps>(({ bg, color, icon, label, loading, value }) => {
  const { styles } = useStyles();
  return (
    <div className={styles.card}>
      <div className={styles.cardIcon} style={{ background: bg }}>
        <Icon color={color} icon={icon} size={20} />
      </div>
      <div className={styles.cardLabel}>{label}</div>
      {loading ? (
        <Skeleton.Button active size="small" style={{ width: 60 }} />
      ) : (
        <div className={styles.cardValue}>{value?.toLocaleString() ?? 0}</div>
      )}
    </div>
  );
});

const AdminOverview = memo(() => {
  const { styles } = useStyles();
  const { data, isLoading } = lambdaQuery.admin.getSystemStats.useQuery();

  return (
    <div className={styles.root}>
      <div className={styles.heading}>Dashboard Overview</div>
      <div className={styles.sub}>Real-time stats for your Chinna Hub instance</div>

      <Flexbox gap={16} horizontal wrap="wrap">
        <StatCard
          bg="#e6f4ff"
          color="#1677ff"
          icon={UsersIcon}
          label="Total Users"
          loading={isLoading}
          value={data?.totalUsers}
        />
        <StatCard
          bg="#f6ffed"
          color="#52c41a"
          icon={ShieldCheckIcon}
          label="Admin Users"
          loading={isLoading}
          value={data?.adminUsers}
        />
        <StatCard
          bg="#fff2f0"
          color="#ff4d4f"
          icon={BanIcon}
          label="Banned Users"
          loading={isLoading}
          value={data?.bannedUsers}
        />
      </Flexbox>
    </div>
  );
});

export default AdminOverview;
