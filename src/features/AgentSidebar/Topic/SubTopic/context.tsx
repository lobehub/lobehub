'use client';

import isEqual from 'fast-deep-equal';
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors, topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import { useTopicListScope } from '../TopicListScope';
import { buildSubTopicTree, type SubTopicNode, type SubTopicTree } from './buildSubTopicTree';
import { useSubTopicTreeSync } from './useSubTopicTreeSync';

interface SubTopicTreeValue {
  childrenOf: (topicId: string) => SubTopicNode[];
  isExpanded: (topicId: string) => boolean;
  nestedIds: ReadonlySet<string>;
  toggle: (topicId: string) => void;
}

const EMPTY_TREE: SubTopicTree = { childrenByRoot: {}, nestedIds: new Set() };
const EMPTY_NODES: SubTopicNode[] = [];

const SubTopicTreeContext = createContext<SubTopicTreeValue | null>(null);

/**
 * The agent sidebar's sub-topic hierarchy (Better Coding Experience): fetches
 * the sub-topics under the visible page once, decides which list rows nest
 * under another, and owns the per-opener expanded state (collapsed by
 * default; the opener of the open conversation unfolds). Off — no provider
 * value — when the lab is off or a project scope owns the list.
 */
export const SubTopicTreeProvider = ({ children }: { children: ReactNode }) => {
  const labEnabled = useUserStore(labPreferSelectors.enableBetterCodingExperience);
  const scope = useTopicListScope();
  const enabled = labEnabled && !scope;

  const topicPageSize = useGlobalStore(systemStatusSelectors.topicPageSize);
  const topicSortBy = useUserStore(preferenceSelectors.topicSortBy);
  const topicIncludeCompleted = useUserStore(preferenceSelectors.topicIncludeCompleted);
  const rows = useChatStore(
    topicSelectors.displayTopicsForSidebar(topicPageSize, topicSortBy, topicIncludeCompleted),
    isEqual,
  );
  const openerIds = useMemo(() => (rows ?? []).map((row) => row.id), [rows]);

  // A parent on this page that is running may open a sub-topic at any moment.
  const parentRunning = useChatStore(
    (s) =>
      (rows ?? []).some((row) => row.status === 'running') ||
      (!!s.activeTopicId &&
        openerIds.includes(s.activeTopicId) &&
        operationSelectors.isAgentRuntimeRunningByContext({
          agentId: s.activeAgentId,
          topicId: s.activeTopicId,
        })(s)),
  );
  const fetched = useSubTopicTreeSync(enabled, openerIds, parentRunning);

  const tree = useMemo(
    () =>
      enabled
        ? buildSubTopicTree(
            (rows ?? []).map((row) => ({ id: row.id, openedBy: row.metadata?.openedBy })),
            fetched as SubTopicNode[],
          )
        : EMPTY_TREE,
    [enabled, rows, fetched],
  );

  const activeTopicId = useChatStore((s) => s.activeTopicId);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // The opener of the open conversation unfolds so the selection stays visible.
  const activeRoot = useMemo(() => {
    if (!activeTopicId) return undefined;
    return Object.entries(tree.childrenByRoot).find(([, nodes]) =>
      nodes.some((node) => node.id === activeTopicId),
    )?.[0];
  }, [activeTopicId, tree]);

  const isExpanded = useCallback(
    (topicId: string) => toggled[topicId] ?? topicId === activeRoot,
    [toggled, activeRoot],
  );
  const toggle = useCallback(
    (topicId: string) =>
      setToggled((prev) => ({ ...prev, [topicId]: !(prev[topicId] ?? topicId === activeRoot) })),
    [activeRoot],
  );

  const value = useMemo<SubTopicTreeValue | null>(
    () =>
      enabled
        ? {
            childrenOf: (topicId) => tree.childrenByRoot[topicId] ?? EMPTY_NODES,
            isExpanded,
            nestedIds: tree.nestedIds,
            toggle,
          }
        : null,
    [enabled, tree, isExpanded, toggle],
  );

  return <SubTopicTreeContext value={value}>{children}</SubTopicTreeContext>;
};

/** The hierarchy, or null when it is off. */
export const useSubTopicTree = () => use(SubTopicTreeContext);

/** List rows that render nested under another row instead of at the top level. */
export const useNestedTopicIds = (): ReadonlySet<string> | undefined =>
  useSubTopicTree()?.nestedIds;
