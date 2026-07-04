'use client';

import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Switch, message } from 'antd';
import { useRouter } from 'next/navigation';

import { trpc } from '@/libs/trpc/client';

export default function RoleEditPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const utils = trpc.useContext();

  const roleQuery = trpc.adminRoles.getRole.useQuery({ id });
  const updateMutation = trpc.adminRoles.updateRole.useMutation({ onSuccess: () => utils.adminRoles.listRoles.invalidate() });
  const deleteMutation = trpc.adminRoles.deleteRole.useMutation({ onSuccess: () => router.push('/admin/roles') });
  const cloneMutation = trpc.adminRoles.createRole.useMutation({ onSuccess: () => utils.adminRoles.listRoles.invalidate() });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [cloneWithAssignments, setCloneWithAssignments] = useState(false);

  useEffect(() => {
    if (roleQuery.data?.data) {
      const r = roleQuery.data.data;
      setName(r.name);
      setDescription(r.description ?? '');
      // For PoC permissions are loaded lazily in future iteration
    }
  }, [roleQuery.data]);

  const onSave = async () => {
    try {
      await updateMutation.mutateAsync({ id, name, description, permissions });
      message.success('Role updated');
    } catch (e) {
      console.error(e);
      message.error('Failed to update role');
    }
  };

  const onDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ id });
      message.success('Role deleted');
    } catch (e) {
      console.error(e);
      message.error('Failed to delete role');
    }
  };

  const onClone = async () => {
    try {
      // Use createRole to create clone then optionally clone assignments via separate endpoint in next iteration
      const newRole = await cloneMutation.mutateAsync({ name: cloneName, scope: roleQuery.data?.data.scope ?? 'global', description: roleQuery.data?.data.description ?? '', permissions: permissions });
      if (cloneWithAssignments) {
        // call cloneRole (we didn't expose dedicated RPC yet) - for now assume backend will handle if we call createRole? TODO: implement clone RPC if needed
      }
      setShowCloneModal(false);
      message.success('Role cloned');
      utils.adminRoles.listRoles.invalidate();
      router.push(`/admin/roles/${newRole.data.id}`);
    } catch (e) {
      console.error(e);
      message.error('Failed to clone role');
    }
  };

  if (roleQuery.isLoading) return <div>Loading...</div>;
  if (!roleQuery.data?.data) return <div>Not found</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Edit Role</h2>
      <div style={{ marginBottom: 12 }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Role name" style={{ width: 400 }} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={4} style={{ width: 600 }} />
      </div>

      {/* Permissions selection UI will be implemented in next iteration (grouped, searchable) */}

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={onSave} loading={updateMutation.isLoading}>Save</Button>
        <Button danger onClick={onDelete} loading={deleteMutation.isLoading}>Delete</Button>
        <Button onClick={() => { setShowCloneModal(true); setCloneName(`${name}-copy`); }}>Clone</Button>
        <Button onClick={() => router.push('/admin/roles')}>Back</Button>
      </Space>

      <Modal title="Clone Role" open={showCloneModal} onOk={onClone} onCancel={() => setShowCloneModal(false)}>
        <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="New role name" style={{ marginBottom: 8 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={cloneWithAssignments} onChange={(v) => setCloneWithAssignments(v)} />
          <div>Also copy existing assignments (users)</div>
        </div>
      </Modal>
    </div>
  );
}
