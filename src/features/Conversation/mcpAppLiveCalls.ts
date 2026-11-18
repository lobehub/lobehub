import type { ChatStoreState } from '@/store/chat/initialState';

type LiveCallState = Pick<
  ChatStoreState,
  'operations' | 'operationsByContext' | 'toolCallingStreamIds' | 'dbMessagesMap'
>;

/** Inspect active work, rather than probing every tool in the conversation history. */
export const getLiveMcpAppToolCalls = (state: LiveCallState, scope: string): string[] => {
  const running = (state.operationsByContext[scope] ?? [])
    .map((id) => state.operations[id])
    .filter((op) => op?.status === 'running');
  if (!running.length) return [];
  const calls = new Set<string>();
  for (const op of running) {
    if (op.type === 'toolCalling' && typeof op.metadata.tool_call_id === 'string')
      calls.add(op.metadata.tool_call_id);
  }
  for (const [messageId, streaming] of Object.entries(state.toolCallingStreamIds)) {
    if (!streaming.some(Boolean)) continue;
    const message = state.dbMessagesMap[scope]?.findLast((row) => row.id === messageId);
    message?.tools?.forEach((tool, index) => {
      if (streaming[index]) calls.add(tool.id);
    });
  }
  return [...calls];
};
