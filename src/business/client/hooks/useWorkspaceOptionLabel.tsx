'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { Avatar, Flexbox, Text } from '@lobehub/ui';
import { type ReactNode, useCallback } from 'react';

import type { WorkspaceListItem } from './useActiveWorkspace';

/**
 * Renders the label content (avatar + name) for a workspace entry inside a
 * Select option. Business builds can override this to append extra info
 * after the name.
 */
export const useWorkspaceOptionLabel = (): ((workspace: WorkspaceListItem) => ReactNode) =>
  useCallback(
    (workspace: WorkspaceListItem) => (
      <Flexbox horizontal align={'center'} gap={10} style={{ flex: 1, minWidth: 0 }}>
        <Avatar avatar={workspace.avatar || DEFAULT_AVATAR} shape={'square'} size={24} />
        <Text ellipsis style={{ flex: '0 1 auto', minWidth: 0 }}>
          {workspace.name}
        </Text>
      </Flexbox>
    ),
    [],
  );
