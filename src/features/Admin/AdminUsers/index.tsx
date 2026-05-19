'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Badge, Button, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type CSSProperties, memo, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

const ROLE_OPTIONS = [
  { label: 'User', value: 'user' },
  { label: 'Pro User', value: 'pro' },
  { label: 'Admin', value: 'admin' },
] as const;

type AppRole = (typeof ROLE_OPTIONS)[number]['value'];

const ROLE_COLORS: Record<string, string> = {
  admin: 'gold',
  pro: 'purple',
  user: 'blue',
};

const roleTag = (role: string | null) => {
  const label = ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role ?? 'User';
  return <Tag color={ROLE_COLORS[role ?? 'user'] ?? 'default'}>{label}</Tag>;
};

type UserRow = {
  banned: boolean | null;
  createdAt: Date | null;
  displayName: string | null;
  email: string | null;
  id: string;
  role: string | null;
  username: string | null;
};

const AdminUsers = memo(() => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const { message } = App.useApp();

  const rootStyle: CSSProperties = {
    width: '100%',
  };

  const headingStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--lobe-color-text, #000)',
  };

  const searchBarStyle: CSSProperties = {
    width: 280,
  };

  const tableWrapStyle: CSSProperties = {
    marginTop: 16,
    background: 'var(--lobe-color-bg-container, #fff)',
    borderRadius: 12,
    border: '1px solid var(--lobe-color-border-secondary, #e5e5e5)',
    overflow: 'hidden',
  };

  const { data, isLoading, refetch } = lambdaQuery.admin.listUsers.useQuery({
    page,
    pageSize: 20,
    search: search || undefined,
  });

  const roleMutation = lambdaQuery.admin.updateUserRole.useMutation({
    onError: () => message.error('Failed to update role'),
    onSuccess: () => {
      message.success('Role updated');
      refetch();
    },
  });

  const banMutation = lambdaQuery.admin.banUser.useMutation({
    onError: () => message.error('Failed to update ban status'),
    onSuccess: () => {
      message.success('User updated');
      refetch();
    },
  });

  const columns: ColumnsType<UserRow> = [
    {
      dataIndex: 'username',
      render: (v: string | null, row) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v || row.displayName || '—'}</div>
          <div style={{ color: 'var(--ant-color-text-tertiary)', fontSize: 12 }}>
            {row.displayName && v ? row.displayName : ''}
          </div>
        </div>
      ),
      title: 'User',
    },
    {
      dataIndex: 'email',
      render: (v: string | null) => v || '—',
      title: 'Email',
    },
    {
      dataIndex: 'role',
      render: (v: string | null) => roleTag(v),
      title: 'Role',
    },
    {
      dataIndex: 'banned',
      render: (v: boolean | null) =>
        v ? <Badge status="error" text="Banned" /> : <Badge status="success" text="Active" />,
      title: 'Status',
    },
    {
      dataIndex: 'createdAt',
      render: (v: Date | null) => (v ? new Date(v).toLocaleDateString() : '—'),
      title: 'Joined',
    },
    {
      fixed: 'right',
      render: (_: unknown, row: UserRow) => (
        <Space size="small">
          <Select<AppRole>
            loading={roleMutation.isPending}
            options={ROLE_OPTIONS}
            size="small"
            style={{ width: 110 }}
            value={(row.role as AppRole) ?? 'user'}
            onChange={(newRole) => roleMutation.mutate({ role: newRole, userId: row.id })}
          />
          <Button
            danger={!row.banned}
            loading={banMutation.isPending}
            size="small"
            type="link"
            onClick={() => banMutation.mutate({ banned: !row.banned, userId: row.id })}
          >
            {row.banned ? 'Unban' : 'Ban'}
          </Button>
        </Space>
      ),
      title: 'Actions',
      width: 200,
    },
  ];

  return (
    <div style={rootStyle}>
      <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
        <span style={headingStyle}>Users</span>
        <Input.Search
          allowClear
          placeholder="Search by username or email"
          style={searchBarStyle}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
      </Flexbox>

      <div style={tableWrapStyle}>
        <Table<UserRow>
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          rowKey="id"
          scroll={{ x: 900 }}
          size="middle"
          style={{ borderRadius: 0 }}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: 20,
            showTotal: (t) => `${t} users`,
            total: data?.total ?? 0,
          }}
        />
      </div>
    </div>
  );
});

export default AdminUsers;
