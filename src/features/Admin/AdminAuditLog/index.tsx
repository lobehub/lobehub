'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, DatePicker, Input, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { createStaticStyles } from 'antd-style';
import { type CSSProperties, memo, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

const useStyles = createStaticStyles(({ css, token }) => ({
  tableWrap: css`
    background: ${token.colorBgContainer};
    border-radius: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    overflow: hidden;
    margin-top: 16px;
  `,
  filters: css`
    margin-bottom: 16px;
    padding: 16px;
    background: ${token.colorBgContainer};
    border-radius: 12px;
    border: 1px solid ${token.colorBorderSecondary};
  `,
}));

type LogRow = {
  id: string;
  adminId: string;
  adminEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
};

const ACTION_COLORS: Record<string, string> = {
  'user.ban': 'red',
  'user.unban': 'green',
  'user.role_update': 'blue',
  'flag.upsert': 'purple',
  'flag.delete': 'orange',
  'flag.user_override': 'cyan',
  'apikey.upsert': 'gold',
  'apikey.enable': 'green',
  'apikey.disable': 'red',
  'apikey.delete': 'orange',
};

const AdminAuditLog = memo(() => {
  const { styles } = useStyles();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [adminIdFilter, setAdminIdFilter] = useState('');
  const [activeFilters, setActiveFilters] = useState<{ action?: string; adminId?: string }>({});

  const { data, isLoading } = lambdaQuery.admin.listAuditLogs.useQuery({
    page,
    pageSize: 20,
    action: activeFilters.action || undefined,
    adminId: activeFilters.adminId || undefined,
  });

  const handleSearch = () => {
    setPage(1);
    setActiveFilters({
      action: actionFilter || undefined,
      adminId: adminIdFilter || undefined,
    });
  };

  const handleExport = () => {
    const rows = data?.items ?? [];
    const csv = [
      'Time,Admin,Action,Target Type,Target ID',
      ...rows.map((r: LogRow) =>
        [
          new Date(r.createdAt).toISOString(),
          r.adminEmail || r.adminId,
          r.action,
          r.targetType || '',
          r.targetId || '',
        ].join(','),
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnsType<LogRow> = [
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v) => new Date(v).toLocaleString(),
      title: 'Time',
      width: 180,
    },
    {
      dataIndex: 'adminEmail',
      key: 'admin',
      render: (email, row) => <span style={{ fontSize: 12 }}>{email || row.adminId}</span>,
      title: 'Admin',
      width: 200,
    },
    {
      dataIndex: 'action',
      key: 'action',
      render: (action) => (
        <Tag color={ACTION_COLORS[action] || 'default'} style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {action}
        </Tag>
      ),
      title: 'Action',
      width: 180,
    },
    {
      key: 'target',
      render: (_, row) =>
        row.targetId ? (
          <Tooltip title={row.targetId}>
            <span style={{ fontSize: 12 }}>
              {row.targetType && <Tag style={{ marginRight: 4 }}>{row.targetType}</Tag>}
              {row.targetId.slice(0, 16)}…
            </span>
          </Tooltip>
        ) : null,
      title: 'Target',
      width: 200,
    },
    {
      dataIndex: 'metadata',
      key: 'metadata',
      render: (meta) =>
        meta ? (
          <Tooltip title={<pre style={{ fontSize: 11 }}>{JSON.stringify(meta, null, 2)}</pre>}>
            <span style={{ cursor: 'help', fontSize: 12, color: 'var(--lobe-color-text-tertiary)' }}>
              View
            </span>
          </Tooltip>
        ) : null,
      title: 'Details',
      width: 80,
    },
  ];

  const headingStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--lobe-color-text, #000)',
  };

  return (
    <div>
      <Flexbox align="center" horizontal justify="space-between">
        <div style={headingStyle}>Audit Log</div>
        <Button icon={<DownloadIcon size={14} />} onClick={handleExport}>
          Export CSV
        </Button>
      </Flexbox>

      <div className={styles.filters}>
        <Space wrap>
          <Input
            allowClear
            placeholder="Filter by action…"
            prefix={<SearchIcon size={14} />}
            style={{ width: 200 }}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            onPressEnter={handleSearch}
          />
          <Input
            allowClear
            placeholder="Filter by admin ID…"
            style={{ width: 220 }}
            value={adminIdFilter}
            onChange={(e) => setAdminIdFilter(e.target.value)}
            onPressEnter={handleSearch}
          />
          <Button type="primary" onClick={handleSearch}>
            Search
          </Button>
        </Space>
      </div>

      <div className={styles.tableWrap}>
        <Table
          columns={columns}
          dataSource={(data?.items ?? []) as LogRow[]}
          loading={isLoading}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: 20,
            showSizeChanger: false,
            total: data?.total ?? 0,
          }}
          rowKey="id"
          size="small"
        />
      </div>
    </div>
  );
});

AdminAuditLog.displayName = 'AdminAuditLog';

export default AdminAuditLog;
