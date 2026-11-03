import type { BuiltinRender } from '@lobechat/types';

export interface BuiltinRenderRegistryEntry {
  apiName: string;
  identifier: string;
  render: BuiltinRender;
}

/**
 * Builtin tools renders registry
 * Organized by toolset (identifier) -> API name
 */
const builtinToolsRenders: Record<string, Record<string, BuiltinRender>> = {};

export const registerBuiltinRenders = (
  entries: Record<string, Record<string, BuiltinRender>>,
): void => {
  for (const [identifier, renders] of Object.entries(entries)) {
    const current = builtinToolsRenders[identifier];
    builtinToolsRenders[identifier] = current ? Object.assign(current, renders) : renders;
  }
};

export const listBuiltinRenderEntries = (): BuiltinRenderRegistryEntry[] =>
  Object.entries(builtinToolsRenders).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinRender] => !!entry[1])
      .map(([apiName, render]) => ({
        apiName,
        identifier,
        render,
      })),
  );

/**
 * Get builtin render component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-local-system')
 * @param apiName - API name (e.g., 'searchFiles')
 */
export const getBuiltinRender = (
  identifier?: string,
  apiName?: string,
): BuiltinRender | undefined => {
  if (!identifier) return undefined;

  const toolset = builtinToolsRenders[identifier];
  if (!toolset) return undefined;

  if (apiName && toolset[apiName]) {
    return toolset[apiName];
  }

  return undefined;
};

export { getBuiltinRenderDisplayControl } from './displayControls';
