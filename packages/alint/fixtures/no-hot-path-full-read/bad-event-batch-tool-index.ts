// Fixture: every Claude Code / Codex event batch re-reads every tool's full
// plugin row (arguments + state) only to rebuild a toolCallId -> id map.
import type { HeteroEvent, HeteroState, PersistenceDeps } from './types';

export async function refreshToolMessageIndex(deps: PersistenceDeps, state: HeteroState) {
  // alint-expect
  const toolPlugins = await deps.messageModel.listMessagePluginsByTopic(state.topicId);

  state.toolMsgIdByCallId.clear();
  for (const plugin of toolPlugins) {
    if (plugin.toolCallId) state.toolMsgIdByCallId.set(plugin.toolCallId, plugin.id);
  }
}

/** Called by the event pump for every batch the CLI emits. */
export async function onEventBatch(
  deps: PersistenceDeps,
  state: HeteroState,
  events: HeteroEvent[],
) {
  await deps.persistEvents(state, events);
  await refreshToolMessageIndex(deps, state);
}
