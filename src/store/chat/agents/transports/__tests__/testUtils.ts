import {
  armClientSubAgentBridgesForContext,
  registerClientSubAgentBridge,
} from '../clientSubAgentBridge';

export const childContext = {
  agentId: 'agent-a',
  threadId: 'thd_child',
  topicId: 'topic-1',
} as any;
export const childContextTopicId = 'topic-1';

export const makeGet = (overrides: Record<string, any> = {}) => {
  const store = {
    completeOperation: vi.fn(),
    dbMessagesMap: {
      // messageMapKey for the thread scope of childContext
      'thread_agent-a_topic-1_thd_child': [
        { content: 'child final answer', role: 'user' },
        { content: 'child final answer', role: 'assistant' },
      ],
    },
    executeClientAgent: vi.fn().mockResolvedValue(undefined),
    internal_createAgentState: vi.fn().mockReturnValue({ context: {}, state: {} }),
    internal_execGroupOrchestration: vi.fn().mockResolvedValue(undefined),
    associateMessageWithOperation: vi.fn(),
    operations: {
      op_child: { status: 'running' },
      op_parent: { status: 'running' },
      op_orch: { status: 'running' },
    },
    optimisticUpdateMessageContent: vi.fn().mockResolvedValue(undefined),
    optimisticUpdatePluginState: vi.fn().mockResolvedValue(undefined),
    startOperation: vi.fn().mockReturnValue({ operationId: 'op_resume' }),
    ...overrides,
  } as any;
  return { get: () => store, store };
};

export const subAgentRegistration = {
  childContext,
  childOperationId: 'op_child',
  kind: 'sub-agent' as const,
  parentContext: { agentId: 'agent-parent', topicId: 'topic-1' } as any,
  parentOperationId: 'op_parent',
  toolMessageId: 'tool-msg-1',
};

export const groupRegistration = {
  childContext,
  childOperationId: 'op_child',
  kind: 'group-orchestration' as const,
  memberAgentId: 'agent-a',
  messageContext: {
    agentId: 'supervisor',
    groupId: 'group-1',
    scope: 'group',
    topicId: 'topic-1',
  } as any,
  orchestrationOperationId: 'op_orch',
  supervisorAgentId: 'supervisor',
  toolMessageId: 'tool-msg-1',
};

/**
 * Round-6: registrations arm at the PARENT's park. Most tests model the
 * already-parked state (they assert the fire/resume behavior), so this
 * helper registers and immediately arms — the shape
 * `registerClientSubAgentBridge` + `armClientSubAgentBridgesForContext`
 * produces in production.
 */
export const registerArmedSubAgentBridge = (
  registration: Parameters<typeof registerClientSubAgentBridge>[0],
) => {
  registerClientSubAgentBridge(registration);
  // Simulate the parent's park: a deferred placeholder row in the parent
  // bucket carrying this child's threadId is what the arm scan matches.
  const threadId = registration.childContext.threadId as string;
  const agentId = (registration as any).parentContext?.agentId ?? 'agent-parent';
  const topicId = (registration as any).parentContext?.topicId ?? childContextTopicId;
  armClientSubAgentBridgesForContext(
    () =>
      ({
        dbMessagesMap: {
          [`main_${agentId}_${topicId}`]: [
            {
              id: (registration as any).toolMessageId,
              pluginState: { status: 'running', threadId },
              role: 'tool',
            },
          ],
        },
      }) as any,
    { agentId, topicId } as any,
  );
};
