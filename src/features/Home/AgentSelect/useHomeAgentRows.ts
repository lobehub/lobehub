'use client';

import type { HomeSidebarEntityRef, HomeSidebarIndex } from '@lobechat/types';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useHomeSidebarIndex } from '@/client-data';
import { useSidebarItemVisibility } from '@/routes/(main)/home/_layout/Body/Agent/useSidebarItemVisibility';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

export type AgentRowRef =
  | { id: string; pinned: false; source: 'builtin' }
  | { id: string; pinned: boolean; ref: HomeSidebarEntityRef; source: 'entity' };

export interface HomeAgentRows {
  /** Whether the canonical sidebar index is available, including an empty index. */
  isInitialized: boolean;
  /** Workspace-private refs owned by the caller. Always empty in personal mode. */
  privateRows: AgentRowRef[];
  /** Whether to render the private/workspace section split. */
  showPrivateSection: boolean;
  /** Inbox + workspace-visible refs. */
  workspaceRows: AgentRowRef[];
}

type KeepSidebarRefs = (refs: HomeSidebarEntityRef[]) => HomeSidebarEntityRef[];

export const resolveHomeAgentRows = (
  index: HomeSidebarIndex | undefined,
  inboxAgentId: string | null | undefined,
  activeWorkspaceId: string | null | undefined,
  keep: KeepSidebarRefs,
): HomeAgentRows => {
  const seen = new Set<string>();

  const collect = (buckets: HomeSidebarEntityRef[][]): AgentRowRef[] => {
    const rows: AgentRowRef[] = [];
    for (const bucket of buckets) {
      for (const ref of keep(bucket)) {
        if (ref.kind !== 'agent' || seen.has(ref.id)) continue;
        seen.add(ref.id);
        rows.push({ id: ref.id, pinned: ref.pinned, ref, source: 'entity' });
      }
    }
    return rows;
  };

  const privateRows = collect([
    index?.privatePinned ?? [],
    index?.privateGroups.flatMap((group) => group.items) ?? [],
    index?.privateUngrouped ?? [],
  ]);

  const workspaceRows: AgentRowRef[] = [];
  if (inboxAgentId && !seen.has(inboxAgentId)) {
    seen.add(inboxAgentId);
    workspaceRows.push({ id: inboxAgentId, pinned: false, source: 'builtin' });
  }
  workspaceRows.push(
    ...collect([
      index?.pinned ?? [],
      index?.groups.flatMap((group) => group.items) ?? [],
      index?.ungrouped ?? [],
    ]),
  );

  return {
    isInitialized: Boolean(index),
    privateRows,
    showPrivateSection: Boolean(activeWorkspaceId) && privateRows.length > 0,
    workspaceRows,
  };
};

/**
 * Index-only read model for the Home Agent switcher. Entity fields are
 * intentionally absent: every rendered row resolves its own Agent record.
 */
export const useHomeAgentRows = (): HomeAgentRows => {
  const { isSidebarItemVisible } = useSidebarItemVisibility();
  const index = useHomeSidebarIndex(isSidebarItemVisible);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const activeWorkspaceId = useActiveWorkspaceId();

  return useMemo(
    () => resolveHomeAgentRows(index, inboxAgentId, activeWorkspaceId, (refs) => refs),
    [activeWorkspaceId, inboxAgentId, index],
  );
};
