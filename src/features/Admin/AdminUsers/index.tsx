'use client';

import { App, Badge, Button, Input, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { createStaticStyles } from 'antd-style';
import { memo, useState } from 'react';

import { Flexbox } from '@lobehub/ui';

import { lambdaQuery } from '@/libs/trpc/client';

const useStyles = createStaticStyles(({ css, token }) => ({
  heading: css`
    font-size: 20px;
    font-weight: 700;
    color: ${token.colorText};
  `,
  root: css`
    width: 100%;
  `,
  searchBar: css`
    width: 280px;
  `,
  tableWrap: css`
    margin-top: 16px;
    background: ${token.colorBgContainer};
    border-radius: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    overflow: hidden;
  `,
}));

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
  const { styles } = useStyles();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

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
      render: (v: string | null) =>
        v === 'admin' ? <Tag color="gold">Admin</Tag> : <Tag color="blue">User</Tag>,
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
          <Button
            loading={roleMutation.isPending}
            size="small"
            type="link"
            onClick={() =>
              roleMutation.mutate({
                role: row.role === 'admin' ? 'user' : 'admin',
                userId: row.id,
              })
            }
          >
            {row.role === 'admin' ? 'Demote' : 'Make Admin'}
          </Button>
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
      width: 180,
    },
  ];

  return (
    <div className={styles.root}>
      <Flexbox align="center" horizontal justify="space-between" style={{ marginBottom: 16 }}>
        <span className={styles.heading}>Users</span>
        <Input.Search
          allowClear
          className={styles.searchBar}
          placeholder="Search by username or email"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
      </Flexbox>

      <div className={styles.tableWrap}>
        <Table<UserRow>
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          pagination={{
            current: page,
            onChange: setPage,
            pageSize: 20,
            showTotal: (t) => `${t} users`,
            total: data?.total ?? 0,
          }}
          rowKey="id"
          scroll={{ x: 900 }}
          size="middle"
          style={{ borderRadius: 0 }}
        />
      </div>
    </div>
  );
});

export default AdminUsers;
