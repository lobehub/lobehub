import { Button, Flexbox, Text } from '@lobehub/ui';
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
        Personal
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
      <Button block loading={creating} size="small" onClick={createWorkspace}>
        Create workspace
      </Button>
    </Flexbox>
  );
}
