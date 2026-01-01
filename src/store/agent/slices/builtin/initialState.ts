export interface BuiltinAgentSliceState {
  /**
   * Builtin agent id mapping { [slug]: agentId }
   * Used to store IDs of builtin agents (page-agent, etc.)
   */
  builtinAgentIdMap: Record<string, string>;
}

export const initialBuiltinAgentSliceState: BuiltinAgentSliceState = {
  builtinAgentIdMap: {},
};
