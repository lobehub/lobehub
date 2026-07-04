'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { trpc } from '@/libs/trpc/client';

type Role = {
  id: string;
  name: string;
  scope: string;
  description?: string | null;
};

export default function AdminRolesPage() {
  const utils = trpc.useContext();
  const { data } = trpc.adminRoles.listRoles.useQuery(undefined);
  const createMutation = trpc.adminRoles.createRole.useMutation({ onSuccess: () => utils.adminRoles.listRoles.invalidate() });

  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'global' | 'workspace' | 'system'>('global');
  const [description, setDescription] = useState('');

  useEffect(() => {
    // no-op
  }, []);

  const onCreate = async () => {
    try {
      await createMutation.mutateAsync({ name, scope, description, permissions: [] });
      setShowModal(false);
      setName('');
      setDescription('');
    } catch (e) {
      console.error(e);
    }
  };

  const columns: ColumnsType<Role> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Scope', dataIndex: 'scope', key: 'scope' },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    {
      title: 'Action',
      key: 'action',
      render: (text, record) => (
        <div>
          <Button type="link" onClick={() => window.location.href = `/admin/roles/${record.id}`}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 20 }}>
      <h2>Roles</h2>
      <Button type="primary" onClick={() => setShowModal(true)}>Create Role</Button>
      <Table dataSource={(data?.data || []) as Role[]} columns={columns} rowKey={(r) => r.id} style={{ marginTop: 12 }} />

      <Modal title="Create Role" open={showModal} onOk={onCreate} onCancel={() => setShowModal(false)}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name" style={{ marginBottom: 8 }} />
        <Select value={scope} onChange={(v: any) => setScope(v)} style={{ width: '100%', marginBottom: 8 }}>
          <Select.Option value="global">Global</Select.Option>
          <Select.Option value="workspace">Workspace</Select.Option>
          <Select.Option value="system">System</Select.Option>
        </Select>
        <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={4} />
      </Modal>
    </div>
  );
}
