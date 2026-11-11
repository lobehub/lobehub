import type { LobeToolManifest } from '@lobechat/context-engine';
import { generateToolsFromManifest } from '@lobechat/context-engine';

import { dropToolFromSet } from '../shareGate/toolSetMutation';
import type { ShareGateToolSet } from '../shareGate/types';

/** Restore the case contract after ordinary device/builtin discovery. Only execution is mocked. */
export const applyFrozenEvalManifests = (
  toolSet: ShareGateToolSet,
  manifests: readonly LobeToolManifest[],
): void => {
  for (const manifest of manifests) {
    const { identifier } = manifest;
    dropToolFromSet(toolSet, identifier);
    toolSet.manifestMap[identifier] = manifest;
    // Bound calls must reach the server's beforeToolCall hook, including native aliases.
    toolSet.executorMap[identifier] = 'server';
    toolSet.sourceMap[identifier] = 'mcp';
    toolSet.enabledToolIds.push(identifier);
    toolSet.activatableToolIds.push(identifier);
    toolSet.tools ??= [];
    toolSet.tools.push(...generateToolsFromManifest(manifest));
  }
};
