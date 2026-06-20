import { Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Link2, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspace } from '../hooks/useActiveWorkspace';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 22px;
    background: ${cssVar.colorBgContainer};
  `,
  hero: css`
    padding: 24px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 26px;
    background:
      radial-gradient(circle at 100% 0, ${cssVar.colorPrimaryBg} 0, transparent 42%),
      linear-gradient(135deg, ${cssVar.colorBgContainer} 0%, ${cssVar.colorFillQuaternary} 100%);
  `,
  controls: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 150px auto;
    gap: 8px;

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  item: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;

    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 18px;

    background: ${cssVar.colorBgContainer};

    @media (width <= 720px) {
      grid-template-columns: 1fr;
    }
  `,
  mobileStack: css`
    @media (width <= 720px) {
      flex-direction: column;
      align-items: stretch;

      > * {
        width: 100% !important;
      }
    }
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const roleOptions = [
  { label: 'Владелец', value: 'owner' },
  { label: 'Участник', value: 'member' },
  { label: 'Наблюдатель', value: 'viewer' },
];

const roleLabel = (role: string) =>
  role === 'owner' ? 'Владелец' : role === 'viewer' ? 'Наблюдатель' : 'Участник';

export default function WorkspaceMembers() {
  const workspace = useActiveWorkspace();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'member' | 'owner' | 'viewer'>('member');
  const [roleFilter, setRoleFilter] = useState<'all' | 'member' | 'owner' | 'viewer'>('all');
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
      setLastInviteUrl(`${origin}/invite/${invitation.token}`);
      setEmail('');
      await mutateInvitations();
    } finally {
      setInviting(false);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredMembers = data.filter((member) => {
    const matchesRole = roleFilter === 'all' || member.role === roleFilter;
    const matchesQuery = !normalizedQuery || member.userId.toLowerCase().includes(normalizedQuery);

    return matchesRole && matchesQuery;
  });

  return (
    <Flexbox gap={18} style={{ maxWidth: 960 }}>
      <Flexbox className={styles.hero} gap={14}>
        <Flexbox horizontal align="center" gap={10}>
          <UsersRound size={24} />
          <Text as="h1" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
            Команда workspace
          </Text>
        </Flexbox>
        <Text type="secondary">
          Приглашайте людей по email или ссылке, назначайте роли и держите доступ к общим агентам,
          знаниям, провайдерам и кредитам под контролем.
        </Text>
        <Flexbox horizontal gap={8}>
          <Tag>{data.length} участников</Tag>
          <Tag>{invitations.length} ожидают</Tag>
          {canManage && <Tag color="green">Можно управлять</Tag>}
        </Flexbox>
      </Flexbox>
      {canManage && (
        <Flexbox className={styles.card} gap={12}>
          <Flexbox horizontal align="center" gap={10}>
            <UserPlus size={20} />
            <Text weight={700}>Пригласить в workspace</Text>
          </Flexbox>
          <Flexbox gap={4}>
            <Text fontSize={13} type="secondary">
              Создайте ссылку и отправьте ее вручную. После входа пользователь вернется на страницу
              приглашения и попадет в нужный workspace.
            </Text>
          </Flexbox>
          <div className={styles.controls}>
            <Input
              placeholder="Email приглашенного"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Select
              options={roleOptions}
              style={{ width: 150 }}
              value={role}
              onChange={(value) => setRole(value as 'member' | 'owner' | 'viewer')}
            />
            <Button loading={inviting} type="primary" onClick={inviteMember}>
              Создать приглашение
            </Button>
          </div>
          {lastInviteUrl && (
            <Flexbox horizontal align="center" className={styles.mobileStack} gap={8}>
              <Input readOnly value={lastInviteUrl} />
              <Button
                icon={<Link2 size={16} />}
                onClick={() => navigator.clipboard.writeText(lastInviteUrl)}
              >
                Скопировать
              </Button>
            </Flexbox>
          )}
          <Flexbox horizontal className={styles.mobileStack} gap={8}>
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
        <Flexbox
          horizontal
          align="center"
          className={styles.mobileStack}
          gap={8}
          justify="space-between"
        >
          <Flexbox gap={2}>
            <Text weight={700}>Участники</Text>
            <Text className={styles.muted} fontSize={13}>
              {filteredMembers.length} из {data.length}
            </Text>
          </Flexbox>
          <Flexbox horizontal className={styles.mobileStack} gap={8}>
            <Input
              placeholder="Поиск по user id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              options={[{ label: 'Все роли', value: 'all' }, ...roleOptions]}
              style={{ width: 150 }}
              value={roleFilter}
              onChange={(value) => setRoleFilter(value as 'all' | 'member' | 'owner' | 'viewer')}
            />
          </Flexbox>
        </Flexbox>
        {filteredMembers.length === 0 && (
          <Flexbox align="center" className={styles.card} gap={4} padding={20}>
            <Text weight={600}>Никого не нашли</Text>
            <Text className={styles.muted} fontSize={13}>
              Измените поиск или фильтр роли.
            </Text>
          </Flexbox>
        )}
        {filteredMembers.map((member) => (
          <div className={styles.item} key={`${member.workspaceId}-${member.userId}`}>
            <Flexbox gap={2}>
              <Text>{member.userId}</Text>
              <Flexbox horizontal gap={6}>
                <Tag>{roleLabel(member.role)}</Tag>
                {member.userId === workspace.primaryOwnerId && <Tag>Основной владелец</Tag>}
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal align="center" className={styles.mobileStack} gap={8}>
              {canManage ? (
                <Select
                  options={roleOptions}
                  style={{ width: 130 }}
                  value={member.role}
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
                <Text className={styles.muted} fontSize={13}>
                  Управлять ролями может только владелец workspace.
                </Text>
              )}
              {canManage && (
                <Button
                  size="small"
                  onClick={async () => {
                    if (!globalThis.confirm('Удалить пользователя из workspace?')) return;
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
          </div>
        ))}
      </Flexbox>
      {canManage && invitations.length > 0 && (
        <Flexbox gap={8}>
          <Text weight={600}>Ожидающие приглашения</Text>
          {invitations.map((invitation) => (
            <div className={styles.item} key={invitation.id}>
              <Flexbox gap={2}>
                <Text>{invitation.email || 'Ссылка-приглашение'}</Text>
                <Text code fontSize={12} type="secondary">
                  /invite/{invitation.token}
                </Text>
              </Flexbox>
              <Flexbox horizontal className={styles.mobileStack} gap={8}>
                <Button
                  size="small"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `${globalThis.location?.origin ?? ''}/invite/${invitation.token}`,
                    )
                  }
                >
                  Скопировать ссылку
                </Button>
                <Button
                  size="small"
                  onClick={async () => {
                    if (!globalThis.confirm('Отозвать это приглашение?')) return;
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
            </div>
          ))}
        </Flexbox>
      )}
      {!canManage && (
        <Flexbox horizontal align="center" className={styles.card} gap={10}>
          <ShieldCheck size={18} />
          <Text type="secondary">
            Роли и приглашения доступны владельцам workspace и super-admin.
          </Text>
        </Flexbox>
      )}
    </Flexbox>
  );
}
