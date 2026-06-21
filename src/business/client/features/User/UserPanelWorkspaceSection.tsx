import { Button, Flexbox, Input, Text } from '@lobehub/ui';
import { createModal, useModalContext } from '@lobehub/ui/base-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspaceId } from '../../hooks/useActiveWorkspaceId';
import { useSwitchWorkspace } from '../../hooks/useSwitchWorkspace';
import { useWorkspaces, WORKSPACE_LIST_KEY } from '../../hooks/useWorkspaces';

interface UserPanelWorkspaceSectionProps {
  onSwitch?: () => void;
}

export default function UserPanelWorkspaceSection({ onSwitch }: UserPanelWorkspaceSectionProps) {
  const activeWorkspaceId = useActiveWorkspaceId();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [creating, setCreating] = useState(false);
  const { switchToPersonal, switchWorkspace } = useSwitchWorkspace();
  const workspaces = useWorkspaces();

  const createWorkspace = async () => {
    setCreating(true);
    try {
      const suffix = Date.now().toString(36);
      const workspace = await lambdaClient.workspace.create.mutate({
        name: 'My Workspace',
        slug: `workspace-${suffix}`,
      });
      await mutate(WORKSPACE_LIST_KEY);
      await switchWorkspace(workspace.id);
      navigate(`/${workspace.slug}`);
      onSwitch?.();
    } finally {
      setCreating(false);
    }
  };

  const openInviteModal = async () => {
    createModal({
      title: 'Принять приглашение',
      width: 'min(90vw, 480px)',
      content: (
        <InviteModalContent
          onAccept={(token) => {
            navigate(`/invite/${token}`);
            onSwitch?.();
          }}
        />
      ),
      footer: null,
      maskClosable: true,
    });
  };

  return (
    <Flexbox gap={8} paddingBlock={8} paddingInline={12}>
      <Text fontSize={12} type="secondary">
        Workspaces
      </Text>
      <Button
        block
        size="small"
        type={activeWorkspaceId ? 'default' : 'primary'}
        onClick={async () => {
          await switchToPersonal();
          navigate('/');
          onSwitch?.();
        }}
      >
        Личное пространство
      </Button>
      {workspaces.map((workspace) => (
        <Button
          block
          key={workspace.id}
          size="small"
          type={activeWorkspaceId === workspace.id ? 'primary' : 'default'}
          onClick={async () => {
            await switchWorkspace(workspace.id);
            navigate(`/${workspace.slug}`);
            onSwitch?.();
          }}
        >
          {workspace.name}
        </Button>
      ))}
      <Button block size="small" onClick={openInviteModal}>
        Принять приглашение
      </Button>
      <Button block loading={creating} size="small" onClick={createWorkspace}>
        Создать workspace
      </Button>
    </Flexbox>
  );
}

interface InviteModalContentProps {
  onAccept: (token: string) => void;
}

function InviteModalContent({ onAccept }: InviteModalContentProps) {
  const { close } = useModalContext();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Введите код приглашения.');
      return;
    }

    setLoading(true);
    try {
      onAccept(trimmed);
      close();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox gap={16} style={{ width: '100%' }}>
      <Text type="secondary">Введите invite код из письма или из ссылки.</Text>
      <Input
        placeholder="invite token"
        value={token}
        onPressEnter={handleAccept}
        onChange={(e) => {
          setError('');
          setToken(e.target.value);
        }}
      />
      {error ? (
        <Text style={{ fontSize: 12 }} type="danger">
          {error}
        </Text>
      ) : null}
      <Flexbox horizontal gap={8} justify="flex-end" style={{ width: '100%' }}>
        <Button disabled={loading} onClick={close}>
          Отмена
        </Button>
        <Button loading={loading} type="primary" onClick={handleAccept}>
          Открыть
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
