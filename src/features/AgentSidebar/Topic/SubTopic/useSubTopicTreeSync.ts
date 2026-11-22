'use client';

import isEqual from 'fast-deep-equal';
import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { subTopicSelectors } from '@/store/chat/selectors';

import { isInFlight, type SubTopicNode } from './buildSubTopicTree';

/**
 * The sub-topics under `openerTopicIds`, kept fresh. Sub-topics are opened and
 * run on the server, out of this client's sight, so the tree polls while one
 * of them is in flight — and while a parent is running, since that is when it
 * can open a new one (`lh topic send --new`). When the parents stop running it
 * reads the tree once more, for a child opened at the very end of the turn.
 */
export const useSubTopicTreeSync = (
  enabled: boolean,
  openerTopicIds: string[],
  parentRunning: boolean,
): SubTopicNode[] => {
  const useFetchSubTopics = useChatStore((s) => s.useFetchSubTopics);
  const refreshSubTopics = useChatStore((s) => s.refreshSubTopics);
  const nodes = useChatStore(subTopicSelectors.treeOf(openerTopicIds), isEqual) as SubTopicNode[];
  useFetchSubTopics(enabled, openerTopicIds, parentRunning || nodes.some(isInFlight));

  const wasRunning = useRef(parentRunning);
  useEffect(() => {
    if (wasRunning.current && !parentRunning && enabled) void refreshSubTopics();
    wasRunning.current = parentRunning;
  }, [enabled, parentRunning, refreshSubTopics]);

  return nodes;
};
