import { Accordion, Flexbox } from '@lobehub/ui';
import React, { type Key, memo, useCallback, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import TaskList from './Task';
import Topic from './Topic';

export enum ChatSidebarKey {
  Tasks = 'tasks',
  Topic = 'topic',
}

// Topic expanded, Tasks collapsed — the resting state for an agent with no
// saved preference (matches the prior `defaultExpandedKeys={[Topic]}`).
const DEFAULT_EXPANDED: Record<string, boolean> = {
  [ChatSidebarKey.Tasks]: false,
  [ChatSidebarKey.Topic]: true,
};

const Body = memo(() => {
  const agentId = useAgentStore((s) => s.activeAgentId);
  // Per-agent expand/collapse state, so switching agents remembers each one's
  // own sidebar layout instead of sharing a single (uncontrolled) accordion.
  const sections = useGlobalStore(systemStatusSelectors.agentSidebarSections(agentId));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const expandedKeys = useMemo(() => {
    const resolved = { ...DEFAULT_EXPANDED, ...sections };
    return Object.keys(resolved).filter((key) => resolved[key]);
  }, [sections]);

  const handleExpandedChange = useCallback(
    (keys: Key[]) => {
      if (!agentId) return;
      updateSystemStatus({
        expandAgentSidebarSectionsByAgent: {
          [agentId]: {
            [ChatSidebarKey.Tasks]: keys.includes(ChatSidebarKey.Tasks),
            [ChatSidebarKey.Topic]: keys.includes(ChatSidebarKey.Topic),
          },
        },
      });
    },
    [agentId, updateSystemStatus],
  );

  return (
    <Flexbox paddingInline={4}>
      <Accordion expandedKeys={expandedKeys} gap={8} onExpandedChange={handleExpandedChange}>
        <TaskList itemKey={ChatSidebarKey.Tasks} />
        <Topic itemKey={ChatSidebarKey.Topic} />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
