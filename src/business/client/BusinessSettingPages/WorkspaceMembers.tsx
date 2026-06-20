import { Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
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
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [role, setRole] = useState<'member' | 'owner' | 'viewer'>('member');
  const [userId, setUserId] = useState('');
  const canManage = workspace?.role === 'owner' || workspace?.role === 'super_admin';
  const { data = [], mutate: mutateMembers } = useSWR(
    workspace ? ['business/workspace-members', workspace.id] : null,
    () => lambdaClient.workspaceMember.list.query({ workspaceId: workspace!.id }),
  );
  const { data: invitations = [], mutate: mutateInvitations } = useSWR(
    workspace && canManage ? ['business/workspace-invitations', workspace.id] : null,
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
      const invitation = await lambdaClient.workspaceMember.invite.mutate({
        email: email.trim() || undefined,
        role,
        workspaceId: workspace.id,
      });
      const origin = globalThis.location?.origin ?? '';
      setLastInviteUrl(`${origin}/${workspace.slug}?invite=${invitation.token}`);
      setEmail('');
      await mutateInvitations();
    } finally {
      setInviting(false);
    }
  };

  return (
    <Flexbox gap={16} style={{ maxWidth: 860 }}>
      <Text type="secondary">
        Участники workspace могут работать в общем контексте команды. Владельцы и super-admin могут
        управлять ролями, приглашениями, тарифом, кредитами и ключами workspace.
      </Text>
      {canManage && (
        <Flexbox
          gap={12}
          padding={16}
          style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 12 }}
        >
          <Flexbox gap={4}>
            <Text weight={600}>Пригласить в workspace</Text>
            <Text fontSize={13} type="secondary">
              Email-приглашение можно принять просто открыв /{workspace.slug}. Ссылку ниже можно
              отправить вручную, если почта не подключена.
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <Input
              placeholder="Email приглашенного"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select
              style={{ width: 150 }}
              value={role}
              options={[
                { label: 'Владелец', value: 'owner' },
                { label: 'Участник', value: 'member' },
                { label: 'Наблюдатель', value: 'viewer' },
              ]}
              onChange={(value) => setRole(value as 'member' | 'owner' | 'viewer')}
            />
            <Button loading={inviting} type="primary" onClick={inviteMember}>
              Создать приглашение
            </Button>
          </Flexbox>
          {lastInviteUrl && (
            <Flexbox horizontal align="center" gap={8}>
              <Input readOnly value={lastInviteUrl} />
              <Button onClick={() => navigator.clipboard.writeText(lastInviteUrl)}>
                Скопировать
              </Button>
            </Flexbox>
          )}
          <Flexbox horizontal gap={8}>
            <Input
              placeholder="ID пользователя для прямого добавления"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
            <Button loading={adding} onClick={addMember}>
              Добавить без приглашения
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      <Flexbox gap={8}>
        <Text weight={600}>Участники</Text>
        {data.map((member) => (
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            key={`${member.workspaceId}-${member.userId}`}
            padding={12}
            style={{ border: '1px solid var(--lobe-color-border-secondary)', borderRadius: 8 }}
          >
            <Flexbox gap={2}>
              <Text>{member.userId}</Text>
              {member.userId === workspace.primaryOwnerId && <Tag>Основной владелец</Tag>}
            </Flexbox>
            <Flexbox horizontal align="center" gap={8}>
              {canManage ? (
                <Select
                  style={{ width: 130 }}
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
              ) : (
                <Tag>
                  {member.role === 'owner'
                    ? 'Владелец'
                    : member.role === 'viewer'
                      ? 'Наблюдатель'
                      : 'Участник'}
                </Tag>
              )}
              {canManage && (
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
              )}
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
      {canManage && invitations.length > 0 && (
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
                  /{workspace.slug}?invite={invitation.token}
                </Text>
              </Flexbox>
              <Flexbox horizontal gap={8}>
                <Button
                  size="small"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `${globalThis.location?.origin ?? ''}/${workspace.slug}?invite=${invitation.token}`,
                    )
                  }
                >
                  Скопировать ссылку
                </Button>
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
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </Flexbox>
  );
}
