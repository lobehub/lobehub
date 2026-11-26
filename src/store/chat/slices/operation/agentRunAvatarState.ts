import type { AgentAvatarState } from '@lobehub/ui';

import { type ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
import { AI_RUNTIME_OPERATION_TYPES, type Operation } from './types';

const isVisiblyRunning = (op: Operation) =>
  op.status === 'running' && !op.metadata.isAborting && !op.metadata.visibleLoadingDone;

const operationsOfType = (
  s: ChatStoreState,
  type: Operation['type'],
  agentId: string,
): Operation[] =>
  (s.operationsByType[type] ?? []).flatMap((id) => {
    const op = s.operations[id];
    return op?.context.agentId === agentId ? [op] : [];
  });

/**
 * What an Agent's avatar acts out for its runs: `thinking` while a run reasons, `working` while it
 * runs otherwise, `blocked` when a topic waits for a person (a tool approval or a question).
 * Undefined when nothing is pending. Only topics loaded on this client can report `blocked`.
 */
export const agentRunAvatarState =
  (agentId: string) =>
  (s: ChatStoreState): AgentAvatarState | undefined => {
    const topics = s.topicDataMap[topicMapKey({ agentId })]?.items;
    const isWaiting = (topicId?: string | null) =>
      !!topicId && topics?.some((t) => t.id === topicId && t.status === 'waitingForHuman');

    // A run paused on a person may keep its operation open; it is waiting, not working.
    const running = AI_RUNTIME_OPERATION_TYPES.some((type) =>
      operationsOfType(s, type, agentId).some(
        (op) => isVisiblyRunning(op) && !isWaiting(op.context.topicId),
      ),
    );
    if (running)
      return operationsOfType(s, 'reasoning', agentId).some(isVisiblyRunning)
        ? 'thinking'
        : 'working';

    return topics?.some((t) => t.status === 'waitingForHuman') ? 'blocked' : undefined;
  };

/** Whether the Agent's latest run finished by itself, rather than failing or being stopped. */
export const isLatestAgentRunCompleted =
  (agentId: string) =>
  (s: ChatStoreState): boolean => {
    const runs = AI_RUNTIME_OPERATION_TYPES.flatMap((type) => operationsOfType(s, type, agentId));
    if (runs.length === 0) return false;
    const latest = runs.reduce((a, b) => (b.metadata.startTime > a.metadata.startTime ? b : a));
    // A run stopped from another tab, device or the API is stored as completed with this flag.
    return latest.status === 'completed' && !latest.metadata.endedWithoutCompletion;
  };
