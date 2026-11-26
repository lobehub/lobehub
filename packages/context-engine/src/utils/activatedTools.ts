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
