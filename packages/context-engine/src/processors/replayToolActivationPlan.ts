import type { ToolActivationPlan } from '@lobechat/types';

import type { LobeToolManifest } from '../engine/tools/types';
import { generateToolsFromManifest } from '../engine/tools/utils';
import type { PipelineContext } from '../types';
import { isActivateToolsCall, readActivatedToolIds } from '../utils/activatedTools';
import { contextReplaySnapshots } from '../utils/contextReplayMessages';

/** A replay anchor can only keep a schema which was absent from the original baseline. */
export const replayToolActivationPlan = (
  context: PipelineContext,
  manifests: LobeToolManifest[],
): ToolActivationPlan | undefined => {
  const own = context.metadata.contextReplaySnapshot;
  if (!own?.toolDefinitions) return;
  const history = contextReplaySnapshots(context.messages).filter(
    (snapshot) => snapshot.sessionKey === own.sessionKey,
  );
  const baseline = history[0]?.toolDefinitions;
  if (!baseline) return;
  const first = new Map<string, string>();
  for (const snapshot of [...history, own])
    for (const [name, revision] of Object.entries(snapshot.toolDefinitions ?? {}))
      if (!first.has(name)) first.set(name, revision);
  const remaining = new Map(manifests.map((manifest) => [manifest.identifier, manifest]));
  const results: ToolActivationPlan['results'] = [];
  for (const message of context.messages) {
    if (
      message.role !== 'tool' ||
      !message.tool_call_id ||
      typeof message.content !== 'string' ||
      !isActivateToolsCall(message.plugin?.identifier, message.plugin?.apiName)
    )
      continue;
    const names: string[] = [];
    for (const id of readActivatedToolIds(message.pluginState)) {
      const manifest = remaining.get(id);
      if (!manifest) continue;
      remaining.delete(id);
      for (const tool of generateToolsFromManifest(manifest)) {
        const name = tool.function.name;
        if (!(name in baseline) && first.get(name) === own.toolDefinitions[name]) names.push(name);
      }
    }
    if (names.length)
      results.push({
        callId: message.tool_call_id,
        content: message.content,
        toolNames: names,
        definitionRevisions: Object.fromEntries(
          names.map((name) => [name, own.toolDefinitions![name]]),
        ),
      });
  }
  return results.length ? { results } : undefined;
};
