'use client';

import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { BanIcon, ShieldCheckIcon, UsersIcon } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

interface StatCardProps {
  bg: string;
  color: string;
  icon: React.ElementType;
  label: string;
  loading?: boolean;
  value?: number;
}

const StatCard = memo<StatCardProps>(({ bg, color, icon, label, loading, value }) => {
  const cardStyle: CSSProperties = {
    flex: 1,
    minWidth: 180,
    padding: '20px 24px',
    borderRadius: 12,
    background: 'var(--lobe-color-bg-container, #fff)',
    border: '1px solid var(--lobe-color-border-secondary, #e5e5e5)',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  };

  const cardIconStyle: CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    background: bg,
  };

  const cardLabelStyle: CSSProperties = {
    fontSize: 13,
    color: 'var(--lobe-color-text-secondary, #666)',
    marginBottom: 6,
  };

  const cardValueStyle: CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--lobe-color-text, #000)',
    lineHeight: 1,
  };

  return (
    <div style={cardStyle}>
      <div style={cardIconStyle}>
        <Icon color={color} icon={icon} size={20} />
      </div>
      <div style={cardLabelStyle}>{label}</div>
      {loading ? (
        <Skeleton.Button active size="small" style={{ width: 60 }} />
      ) : (
        <div style={cardValueStyle}>{value?.toLocaleString() ?? 0}</div>
      )}
    </div>
  );
});

const AdminOverview = memo(() => {
  const { data, isLoading } = lambdaQuery.admin.getSystemStats.useQuery();

  const rootStyle: CSSProperties = {
    width: '100%',
  };

  const headingStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--lobe-color-text, #000)',
    marginBottom: 4,
  };

  const subStyle: CSSProperties = {
    fontSize: 13,
    color: 'var(--lobe-color-text-tertiary, #999)',
    marginBottom: 24,
  };

  return (
    <div style={rootStyle}>
      <div style={headingStyle}>Dashboard Overview</div>
      <div style={subStyle}>Real-time stats for your Chinna Hub instance</div>

      <Flexbox horizontal gap={16} wrap="wrap">
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
