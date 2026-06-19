import type { ItemType } from 'antd/es/menu/interface';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';
import { useWorkspaces } from './useWorkspaces';

interface TransferItemsParams {
  copy?: (targetWorkspaceId: string | null) => Promise<unknown>;
  enabled?: boolean;
  move?: (targetWorkspaceId: string | null) => Promise<unknown>;
}

export const useWorkspaceTransferItems = ({ copy, enabled = true, move }: TransferItemsParams) => {
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();
  if (!enabled || (!move && !copy)) return null;

  const targets = [
    { id: null, name: 'Личное пространство' },
    ...workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
  ].filter((target) => target.id !== activeWorkspaceId);

  const children: ItemType[] = [];

  if (move) {
    children.push({
      children: targets.map((target) => ({
        key: `move-${target.id ?? 'personal'}`,
        label: target.name,
        onClick: () => void move(target.id),
      })),
      key: 'move-to-workspace',
      label: 'Переместить в',
    });
  }

  if (copy) {
    children.push({
      children: targets.map((target) => ({
        key: `copy-${target.id ?? 'personal'}`,
        label: target.name,
        onClick: () => void copy(target.id),
      })),
      key: 'copy-to-workspace',
      label: 'Скопировать в',
    });
  }

  return children;
};
