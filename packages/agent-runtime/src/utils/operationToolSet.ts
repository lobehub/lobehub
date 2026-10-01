import type { OperationToolSet } from '@lobechat/context-engine';

import type { AgentState } from '../types';

/** Every place a run's tool set can be found on the state. */
type ToolSetCarrier = Pick<
  AgentState,
  'operationToolSet' | 'toolExecutorMap' | 'toolManifestMap' | 'toolSourceMap' | 'tools'
>;

/**
 * Read the run's tool set from the operation slot.
 *
 * The slot is the only copy a host writes: manifest maps are the heaviest thing
 * on the state (a full manifest carries every API schema and system role), and
 * the state is re-serialized into Redis at every step boundary, so keeping a
 * second copy doubled that cost for nothing.
 *
 * Operations that started before the slot existed carry the four maps at the top
 * level instead. `normalizeAgentState` lifts those into the slot when the blob is
 * loaded; these readers accept them directly too, so an in-memory state that
 * never passed the load path still resolves its tools.
 */
export const selectRunTools = (state: Partial<ToolSetCarrier>): any[] | undefined =>
  state.operationToolSet?.tools ?? state.tools;

export const selectToolManifestMap = (state: Partial<ToolSetCarrier>): Record<string, any> =>
  state.operationToolSet?.manifestMap ?? state.toolManifestMap ?? {};

export const selectToolSourceMap = (
  state: Partial<ToolSetCarrier>,
): NonNullable<AgentState['toolSourceMap']> =>
  state.operationToolSet?.sourceMap ?? state.toolSourceMap ?? {};

export const selectToolExecutorMap = (
  state: Partial<ToolSetCarrier>,
): NonNullable<AgentState['toolExecutorMap']> =>
  state.operationToolSet?.executorMap ?? state.toolExecutorMap ?? {};

/**
 * The whole set as one struct, for callers that hand it to the resolvers.
 * A legacy state has no `enabledToolIds` anywhere — it predates the slot — so
 * the step delta starts from nothing, exactly as the old inline fallback did.
 */
export const selectOperationToolSet = (state: Partial<ToolSetCarrier>): OperationToolSet =>
  state.operationToolSet ?? {
    enabledToolIds: [],
    executorMap: selectToolExecutorMap(state),
    manifestMap: selectToolManifestMap(state),
    sourceMap: selectToolSourceMap(state),
    tools: selectRunTools(state) ?? [],
  };
