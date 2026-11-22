import type { Message } from '../types';

/**
 * Wire-format identifier of the activation tool. Literal copy of
 * `LobeActivatorIdentifier` (@lobechat/builtin-tool-activator): frozen, persisted in
 * message rows, and not importable here without a tool-package dependency.
 */
const ACTIVATOR_IDENTIFIER = 'lobe-activator';
const ACTIVATE_TOOLS_API = 'activateTools';

export interface ActivateToolsState {
  activatedSkills?: unknown[];
  activatedTools?: Array<{ identifier?: string }>;
}

export const readActivatedToolIds = (state: unknown): string[] => {
  const activatedTools = (state as ActivateToolsState | undefined)?.activatedTools;
  if (!Array.isArray(activatedTools)) return [];

  return activatedTools.flatMap((tool) => (tool?.identifier ? [tool.identifier] : []));
};

export const isActivateToolsCall = (identifier?: string, apiName?: string) =>
  identifier === ACTIVATOR_IDENTIFIER && apiName === ACTIVATE_TOOLS_API;

/**
 * Identifiers of the tools that `activateTools` results in `messages` activated, in
 * activation order.
 *
 * Reads both shapes a result has before the flatten processors run: a flat
 * `role: 'tool'` row, and a tool nested in an `assistantGroup` child. A compressed
 * group is skipped on purpose: it reaches the model as a summary, so the results inside
 * it are not part of the request.
 */
export const collectActivatedToolIds = (messages: Message[]): string[] => {
  const toolIds = new Set<string>();
  const add = (state: unknown) => {
    for (const id of readActivatedToolIds(state)) toolIds.add(id);
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      if (isActivateToolsCall(message.plugin?.identifier, message.plugin?.apiName)) {
        add(message.pluginState);
      }
      continue;
    }

    if (!Array.isArray(message.children)) continue;
    for (const child of message.children) {
      if (!Array.isArray(child?.tools)) continue;
      for (const tool of child.tools) {
        if (isActivateToolsCall(tool?.identifier, tool?.apiName)) add(tool?.result?.state);
      }
    }
  }

  return [...toolIds];
};
