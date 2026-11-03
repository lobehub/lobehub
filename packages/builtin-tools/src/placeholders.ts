import type { BuiltinPlaceholder } from '@lobechat/types';

/**
 * Builtin tools placeholders registry
 * Organized by toolset (identifier) -> API name
 */
const builtinToolPlaceholders: Record<string, Record<string, BuiltinPlaceholder>> = {};

export const registerBuiltinPlaceholders = (
  entries: Record<string, Record<string, BuiltinPlaceholder>>,
): void => {
  for (const [identifier, placeholders] of Object.entries(entries)) {
    const current = builtinToolPlaceholders[identifier];
    builtinToolPlaceholders[identifier] = current
      ? Object.assign(current, placeholders)
      : placeholders;
  }
};

export interface BuiltinPlaceholderRegistryEntry {
  apiName: string;
  identifier: string;
  placeholder: BuiltinPlaceholder;
}

export const listBuiltinPlaceholderEntries = (): BuiltinPlaceholderRegistryEntry[] =>
  Object.entries(builtinToolPlaceholders).flatMap(([identifier, toolset]) =>
    Object.entries(toolset)
      .filter((entry): entry is [string, BuiltinPlaceholder] => !!entry[1])
      .map(([apiName, placeholder]) => ({
        apiName,
        identifier,
        placeholder,
      })),
  );

/**
 * Get builtin placeholder component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-local-system')
 * @param apiName - API name (e.g., 'searchLocalFiles')
 */
export const getBuiltinPlaceholder = (
  identifier?: string,
  apiName?: string,
): BuiltinPlaceholder | undefined => {
  if (!identifier || !apiName) return undefined;

  const toolset = builtinToolPlaceholders[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
