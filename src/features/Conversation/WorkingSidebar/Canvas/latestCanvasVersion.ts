import { CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import type { UIChatMessage } from '@lobechat/types';

const SAVE_APIS = new Set<string>([CanvasApiName.createCanvas, CanvasApiName.updateCanvas]);

export const getLatestCanvasVersion = (messages: UIChatMessage[], canvasId: string) => {
  let latest = 0;
  for (const message of messages) {
    for (const work of message.works ?? []) {
      if (work.type !== 'canvas' || work.resourceId !== canvasId) continue;
      latest = Math.max(latest, work.event?.version ?? 0, work.version?.version ?? 0);
    }
  }
  return latest;
};

export const getLatestSavedManifestKey = (messages: UIChatMessage[], canvasId: string) => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool' || message.plugin?.identifier !== CanvasIdentifier) continue;
    if (!SAVE_APIS.has(message.plugin.apiName) || message.pluginState?.canvasId !== canvasId)
      continue;
    const manifestKey = message.pluginState?.metadata?.manifestKey;
    if (typeof manifestKey === 'string') return manifestKey;
  }
};
