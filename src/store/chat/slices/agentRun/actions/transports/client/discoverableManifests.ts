import type { LobeToolManifest } from '@lobechat/context-engine';

import type { ToolStoreState } from '@/store/tool/initialState';
import { toolSelectors } from '@/store/tool/selectors/tool';

// Mirrors the server's discovery pool: the map is broader than `enabledToolIds`, so a
// tool activated mid-run is looked up by the approval guard instead of being unknown.
export const buildRunManifestMap = (
  toolState: ToolStoreState,
  enabledManifests: LobeToolManifest[],
): Record<string, LobeToolManifest> => {
  const map: Record<string, LobeToolManifest> = {};

  for (const { identifier } of toolSelectors.availableToolsForDiscovery(toolState)) {
    const manifest = toolSelectors.getManifestById(identifier)(toolState);
    if (manifest) map[identifier] = manifest as LobeToolManifest;
  }
  for (const manifest of enabledManifests) map[manifest.identifier] = manifest;

  return map;
};
