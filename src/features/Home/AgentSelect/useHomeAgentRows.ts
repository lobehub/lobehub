'use client';

import type {
  HomeSidebarGroupIndex,
  HomeSidebarIndex,
  HomeSidebarProjectionRef,
} from '@lobechat/types';
import { useMemo } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useSidebarGroupVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarGroupVisibility';
import { useSidebarItemVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility';
import { useHomeSidebarIndex } from '@/projection';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

export type AgentRowRef =
  | { id: string; pinned: false; source: 'builtin' }
  | { id: string; pinned: boolean; ref: HomeSidebarProjectionRef; source: 'entity' };

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

type KeepSidebarRefs = (refs: HomeSidebarProjectionRef[]) => HomeSidebarProjectionRef[];
type KeepSidebarGroups = (groups: HomeSidebarGroupIndex[]) => HomeSidebarGroupIndex[];

const keepAllGroups: KeepSidebarGroups = (groups) => groups;

export const resolveHomeAgentRows = (
  index: HomeSidebarIndex | undefined,
  inboxAgentId: string | null | undefined,
  activeWorkspaceId: string | null | undefined,
  keep: KeepSidebarRefs,
  keepGroups: KeepSidebarGroups = keepAllGroups,
): HomeAgentRows => {
  const seen = new Set<string>();

  const collect = (buckets: HomeSidebarProjectionRef[][]): AgentRowRef[] => {
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
    keepGroups(index?.privateGroups ?? []).flatMap((group) => group.items),
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
      keepGroups(index?.groups ?? []).flatMap((group) => group.items),
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
  const { isSidebarGroupVisible } = useSidebarGroupVisibility();
  const index = useHomeSidebarIndex(isSidebarItemVisible);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const activeWorkspaceId = useActiveWorkspaceId();

  return useMemo(
    () =>
      // An agent inside a Category the caller hid must not resurface in the
      // home switcher, mirroring the sidebar lists and agent-detail switcher.
      resolveHomeAgentRows(
        index,
        inboxAgentId,
        activeWorkspaceId,
        (refs) => refs,
        (groups) => groups.filter((group) => isSidebarGroupVisible(group.id)),
      ),
    [activeWorkspaceId, inboxAgentId, index, isSidebarGroupVisible],
  );
};
