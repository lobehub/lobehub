import { AttachmentsIdentifier } from '@lobechat/builtin-tool-attachments';
import type { LobeToolManifest } from '@lobechat/context-engine';

import type { RunConnectorsTarget } from '@/services/runConnectors';
import type { ToolStoreState } from '@/store/tool/initialState';
import { toolSelectors } from '@/store/tool/selectors/tool';

// Mirrors the server's discovery pool: the map is broader than `enabledToolIds`, so a
// tool activated mid-run is looked up by the approval guard instead of being unknown.
export const buildRunManifestMap = (
  toolState: ToolStoreState,
  eligibleManifests: ReadonlyMap<string, LobeToolManifest>,
  enabledManifests: LobeToolManifest[],
  /** The conversation: its connector rows are the ones discoverable. */
  run: RunConnectorsTarget = {},
): Record<string, LobeToolManifest> => {
  const map: Record<string, LobeToolManifest> = {};

  const ids = [
    ...toolSelectors.availableToolsForDiscovery(toolState, run).map((t) => t.identifier),
    // Oversized attachments need a reader that is hidden from the global catalog.
    AttachmentsIdentifier,
  ];
  for (const id of ids) {
    const manifest = eligibleManifests.get(id);
    if (manifest) map[id] = manifest;
  }
  for (const manifest of enabledManifests) map[manifest.identifier] = manifest;

  return map;
};
