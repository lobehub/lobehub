import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemListFilesPlaceholder,
  LocalSystemSearchFilesPlaceholder,
} from '@lobechat/builtin-tool-local-system/client';
import {
  WebBrowsingManifest,
  WebBrowsingPlaceholders,
} from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinPlaceholder } from '@lobechat/types';

/**
 * Builtin tools placeholders registry
 * Organized by toolset (identifier) -> API name
 */
export const BuiltinToolPlaceholders: Record<string, Record<string, any>> = {
  [LocalSystemIdentifier]: {
    [LocalSystemApiName.searchFiles]: LocalSystemSearchFilesPlaceholder,
    [LocalSystemApiName.listFiles]: LocalSystemListFilesPlaceholder,
    // Legacy aliases — keep these so historical messages keep rendering
    listLocalFiles: LocalSystemListFilesPlaceholder,
    searchLocalFiles: LocalSystemSearchFilesPlaceholder,
  },
  [WebBrowsingManifest.identifier]: WebBrowsingPlaceholders as Record<string, any>,
};

export interface BuiltinPlaceholderRegistryEntry {
  apiName: string;
  identifier: string;
  placeholder: BuiltinPlaceholder;
}

export const listBuiltinPlaceholderEntries = (): BuiltinPlaceholderRegistryEntry[] =>
  Object.entries(BuiltinToolPlaceholders).flatMap(([identifier, toolset]) =>
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

  const toolset = BuiltinToolPlaceholders[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
