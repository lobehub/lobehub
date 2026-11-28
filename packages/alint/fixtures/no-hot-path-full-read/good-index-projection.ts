// Fixture: the per-batch index read selects only the index columns.
import { HETEROGENEOUS_INTERVENTION_STATE_KEY } from './const';
import type { HeteroEvent, HeteroState, PersistenceDeps } from './types';

export async function refreshToolMessageIndex(deps: PersistenceDeps, state: HeteroState) {
  // Runs once per event batch over the whole topic: read only the index
  // columns, not every tool's arguments and state.
  const toolPlugins = await deps.messageModel.listToolCallIndexByTopic(state.topicId, {
    interventionStateKey: HETEROGENEOUS_INTERVENTION_STATE_KEY,
  });

  state.toolMsgIdByCallId.clear();
  for (const plugin of toolPlugins) {
    if (plugin.toolCallId) state.toolMsgIdByCallId.set(plugin.toolCallId, plugin.id);
  }
}

export async function onEventBatch(
  deps: PersistenceDeps,
  state: HeteroState,
  events: HeteroEvent[],
) {
  await deps.persistEvents(state, events);
  await refreshToolMessageIndex(deps, state);
}
