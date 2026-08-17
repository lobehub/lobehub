import type { DropdownItem } from '@lobehub/ui/base-ui';

export interface LibraryMenuEntry {
  item: NonNullable<DropdownItem>;
  visibility?: 'private' | 'public';
}

interface LibraryMenuLabels {
  private: string;
  workspace: string;
}

/**
 * Match the Agent switcher: only introduce visibility sections in a workspace
 * when there is something private to distinguish from the shared list.
 */
export const buildLibraryMenuItems = (
  entries: LibraryMenuEntry[],
  hasActiveWorkspace: boolean,
  labels: LibraryMenuLabels,
): DropdownItem[] => {
  const flatItems = entries.map(({ item }) => item);
  const privateItems = entries
    .filter(({ visibility }) => visibility === 'private')
    .map(({ item }) => item);

  if (!hasActiveWorkspace || privateItems.length === 0) return flatItems;

  const workspaceItems = entries
    .filter(({ visibility }) => visibility !== 'private')
    .map(({ item }) => item);

  return [
    {
      children: privateItems,
      key: 'library-group-private',
      label: labels.private,
      type: 'group',
    },
    ...(workspaceItems.length > 0
      ? [
          {
            children: workspaceItems,
            key: 'library-group-workspace',
            label: labels.workspace,
            type: 'group' as const,
          },
        ]
      : []),
  ];
};
