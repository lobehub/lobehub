'use client';

import isEqual from 'fast-deep-equal';
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react';

import { useChatStore } from '@/store/chat';
import { subSessionSelectors, topicSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import { useTopicListScope } from '../TopicListScope';
import {
  buildSubSessionTree,
  isInFlight,
  type SubSessionNode,
  type SubSessionTree,
} from './buildSubSessionTree';

interface SubSessionTreeValue {
  childrenOf: (topicId: string) => SubSessionNode[];
  isExpanded: (topicId: string) => boolean;
  nestedIds: ReadonlySet<string>;
  toggle: (topicId: string) => void;
}

const EMPTY_TREE: SubSessionTree = { childrenByRoot: {}, nestedIds: new Set() };
const EMPTY_NODES: SubSessionNode[] = [];

const SubSessionTreeContext = createContext<SubSessionTreeValue | null>(null);

/**
 * The agent sidebar's sub-session hierarchy (Better Coding Experience): fetches
 * the sub-sessions under the visible page once, decides which list rows nest
 * under another, and owns the per-opener expanded state (collapsed by
 * default; the opener of the open conversation unfolds). Off — no provider
 * value — when the lab is off or a project scope owns the list.
 */
export const SubSessionTreeProvider = ({ children }: { children: ReactNode }) => {
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

  const useFetchSubSessions = useChatStore((s) => s.useFetchSubSessions);
  const fetched = useChatStore(subSessionSelectors.treeOf(openerIds), isEqual);
  useFetchSubSessions(enabled, openerIds, fetched.some(isInFlight));

  const tree = useMemo(
    () =>
      enabled
        ? buildSubSessionTree(
            (rows ?? []).map((row) => ({ id: row.id, openedBy: row.metadata?.openedBy })),
            fetched as SubSessionNode[],
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

  const value = useMemo<SubSessionTreeValue | null>(
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

  return <SubSessionTreeContext value={value}>{children}</SubSessionTreeContext>;
};

/** The hierarchy, or null when it is off. */
export const useSubSessionTree = () => use(SubSessionTreeContext);

/** List rows that render nested under another row instead of at the top level. */
export const useNestedTopicIds = (): ReadonlySet<string> | undefined =>
  useSubSessionTree()?.nestedIds;
