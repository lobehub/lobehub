interface AgentIdStoreSyncOptions {
  activeId?: string;
  topicFromPath?: string;
  topicFromQuery?: string | null;
}

export const useAgentIdStoreSync = (_options: AgentIdStoreSyncOptions) => {
  void _options;
};
