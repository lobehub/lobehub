import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
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

  if (!workspace)
    return <Text type="secondary">Выберите workspace для управления участниками.</Text>;

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
        Владельцы могут приглашать пользователей, добавлять внутренних пользователей, менять роли и
        удалять участников.
      </Text>
      <Flexbox horizontal gap={8}>
        <Input
          placeholder="Email для приглашения"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Select
          style={{ width: 140 }}
          value={role}
          options={[
            { label: 'Владелец', value: 'owner' },
            { label: 'Участник', value: 'member' },
            { label: 'Наблюдатель', value: 'viewer' },
          ]}
          onChange={(value) => setRole(value as 'member' | 'owner' | 'viewer')}
        />
        <Button loading={inviting} type="primary" onClick={inviteMember}>
          Пригласить
        </Button>
      </Flexbox>
      <Flexbox horizontal gap={8}>
        <Input
          placeholder="ID пользователя"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Button loading={adding} type="primary" onClick={addMember}>
          Добавить
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
                  { label: 'Владелец', value: 'owner' },
                  { label: 'Участник', value: 'member' },
                  { label: 'Наблюдатель', value: 'viewer' },
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
                Удалить
              </Button>
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
      {invitations.length > 0 && (
        <Flexbox gap={8}>
          <Text weight={600}>Ожидающие приглашения</Text>
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
                <Text>{invitation.email || 'Ссылка-приглашение'}</Text>
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
                Отозвать
              </Button>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}
