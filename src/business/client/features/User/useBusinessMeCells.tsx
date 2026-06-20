import { BriefcaseBusiness, Plus, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';

import { type CellProps } from '@/components/Cell';
import { lambdaClient } from '@/libs/trpc/client';

import { useActiveWorkspaceId } from '../../hooks/useActiveWorkspaceId';
import { useSwitchWorkspace } from '../../hooks/useSwitchWorkspace';
import { useWorkspaces, WORKSPACE_LIST_KEY } from '../../hooks/useWorkspaces';

export default function useBusinessMeCells(): CellProps[] {
  const activeWorkspaceId = useActiveWorkspaceId();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const [creating, setCreating] = useState(false);
  const { switchToPersonal, switchWorkspace } = useSwitchWorkspace();
  const workspaces = useWorkspaces();

  const createWorkspace = async () => {
    if (creating) return;

    setCreating(true);
    try {
      const suffix = Date.now().toString(36);
      const workspace = await lambdaClient.workspace.create.mutate({
        name: 'Мой workspace',
        slug: `workspace-${suffix}`,
      });
      await mutate(WORKSPACE_LIST_KEY);
      await switchWorkspace(workspace.id);
      navigate(`/${workspace.slug}`);
    } finally {
      setCreating(false);
    }
  };

  return [
    { type: 'divider' },
    {
      icon: UserRound,
      key: 'personal-workspace',
      label: activeWorkspaceId ? 'Перейти в личное пространство' : 'Личное пространство активно',
      onClick: async () => {
        await switchToPersonal();
        navigate('/');
      },
    },
    ...workspaces.map(
      (workspace): CellProps => ({
        icon: BriefcaseBusiness,
        key: `workspace-${workspace.id}`,
        label: `${activeWorkspaceId === workspace.id ? '✓ ' : ''}${workspace.name}`,
        onClick: async () => {
          await switchWorkspace(workspace.id);
          navigate(`/${workspace.slug}`);
        },
      }),
    ),
    {
      icon: Plus,
      key: 'create-workspace',
      label: creating ? 'Создаём workspace...' : 'Создать workspace',
      onClick: createWorkspace,
    },
    { type: 'divider' },
  ];
}
