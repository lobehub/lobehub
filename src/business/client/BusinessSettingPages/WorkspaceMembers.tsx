import { Button, Flexbox, Input, Select, Text } from '@lobehub/ui';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

export default function WorkspaceMembers() {
  const workspace = useActiveWorkspace();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<'member' | 'owner' | 'viewer'>('member');
  const [userId, setUserId] = useState('');
  const { data = [], mutate: mutateMembers } = useSWR(
    workspace ? ['business/workspace-members', workspace.id] : null,
    () => lambdaClient.workspaceMember.list.query({ workspaceId: workspace!.id }),
  );
  const { data: invitations = [], mutate: mutateInvitations } = useSWR(
    workspace ? ['business/workspace-invitations', workspace.id] : null,
    () => lambdaClient.workspaceMember.listInvitations.query({ workspaceId: workspace!.id }),
  );

  if (!workspace) return <Text type="secondary">Select a workspace to manage members.</Text>;

  const addMember = async () => {
    if (!userId.trim()) return;
    setAdding(true);
    try {
      await lambdaClient.workspaceMember.add.mutate({
        role,
        userId: userId.trim(),
        workspaceId: workspace.id,
      });
      setUserId('');
      await mutateMembers();
    } finally {
      setAdding(false);
    }
  };

  const inviteMember = async () => {
    setInviting(true);
    try {
      await lambdaClient.workspaceMember.invite.mutate({
        email: email.trim() || undefined,
        role,
        workspaceId: workspace.id,
      });
      setEmail('');
      await mutateInvitations();
    } finally {
      setInviting(false);
    }
  };

  return (
    <Flexbox gap={16} style={{ maxWidth: 720 }}>
      <Text type="secondary">
        Owners can invite users, add known internal users, update roles, and remove members.
      </Text>
      <Flexbox horizontal gap={8}>
        <Input
          placeholder="Email for invitation"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select
          style={{ width: 140 }}
          value={role}
          options={[
            { label: 'Owner', value: 'owner' },
            { label: 'Member', value: 'member' },
            { label: 'Viewer', value: 'viewer' },
          ]}
          onChange={(value) => setRole(value as 'member' | 'owner' | 'viewer')}
        />
        <Button loading={inviting} type="primary" onClick={inviteMember}>
          Invite
        </Button>
      </Flexbox>
      <Flexbox horizontal gap={8}>
        <Input placeholder="User id" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <Button loading={adding} type="primary" onClick={addMember}>
          Add
        </Button>
      </Flexbox>
      <Flexbox gap={8}>
        {data.map((member) => (
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            key={`${member.workspaceId}-${member.userId}`}
            padding={12}
            style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 8 }}
          >
            <Text>{member.userId}</Text>
            <Flexbox horizontal align="center" gap={8}>
              <Select
                style={{ width: 120 }}
                value={member.role}
                options={[
                  { label: 'Owner', value: 'owner' },
                  { label: 'Member', value: 'member' },
                  { label: 'Viewer', value: 'viewer' },
                ]}
                onChange={async (value) => {
                  await lambdaClient.workspaceMember.updateRole.mutate({
                    role: value as 'member' | 'owner' | 'viewer',
                    userId: member.userId,
                    workspaceId: workspace.id,
                  });
                  await mutateMembers();
                }}
              />
              <Button
                size="small"
                onClick={async () => {
                  await lambdaClient.workspaceMember.remove.mutate({
                    userId: member.userId,
                    workspaceId: workspace.id,
                  });
                  await mutateMembers();
                }}
              >
                Remove
              </Button>
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
      {invitations.length > 0 && (
        <Flexbox gap={8}>
          <Text weight={600}>Pending invitations</Text>
          {invitations.map((invitation) => (
            <Flexbox
              horizontal
              align="center"
              justify="space-between"
              key={invitation.id}
              padding={12}
              style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 8 }}
            >
              <Flexbox gap={2}>
                <Text>{invitation.email || 'Invitation link'}</Text>
                <Text code fontSize={12} type="secondary">
                  {invitation.token}
                </Text>
              </Flexbox>
              <Button
                size="small"
                onClick={async () => {
                  await lambdaClient.workspaceMember.revokeInvitation.mutate({
                    id: invitation.id,
                    workspaceId: workspace.id,
                  });
                  await mutateInvitations();
                }}
              >
                Revoke
              </Button>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}
