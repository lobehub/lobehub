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
    [LocalSystemApiName.searchLocalFiles]: LocalSystemSearchFilesPlaceholder,
    [LocalSystemApiName.listLocalFiles]: LocalSystemListFilesPlaceholder,
  },
  [WebBrowsingManifest.identifier]: WebBrowsingPlaceholders as Record<string, any>,
};

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
