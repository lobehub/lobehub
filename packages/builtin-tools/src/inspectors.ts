import type { BuiltinInspector } from '@lobechat/types';

/**
 * Builtin tools inspector registry
 * Organized by toolset (identifier) -> API name
 *
 * Inspector components are used to customize the title/header area
 * of tool calls in the conversation UI.
 */
const builtinToolInspectors: Record<string, Record<string, BuiltinInspector>> = {};

export const registerBuiltinInspectors = (
  entries: Record<string, Record<string, BuiltinInspector>>,
): void => {
  for (const [identifier, inspectors] of Object.entries(entries)) {
    const current = builtinToolInspectors[identifier];
    builtinToolInspectors[identifier] = current ? Object.assign(current, inspectors) : inspectors;
  }
};

export interface BuiltinInspectorRegistryEntry {
  apiName: string;
  identifier: string;
  inspector: BuiltinInspector;
}

export const listBuiltinInspectorEntries = (): BuiltinInspectorRegistryEntry[] =>
  Object.entries(builtinToolInspectors).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinInspector] => !!entry[1])
      .map(([apiName, inspector]) => ({
        apiName,
        identifier,
        inspector,
      })),
  );

/**
 * Get builtin inspector component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-code-interpreter')
 * @param apiName - API name (e.g., 'executeCode')
 */
export const getBuiltinInspector = (
  identifier?: string,
  apiName?: string,
): BuiltinInspector | undefined => {
  if (!identifier || !apiName) return undefined;

  const toolset = builtinToolInspectors[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
