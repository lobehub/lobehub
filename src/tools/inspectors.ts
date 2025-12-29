import { GTDInspectors, GTDManifest } from '@lobechat/builtin-tool-gtd/client';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { PageAgentIdentifier, PageAgentInspectors } from '@lobechat/builtin-tool-page-agent/client';
import { type BuiltinInspector } from '@lobechat/types';

import { CodeInterpreterInspectors } from './code-interpreter/Inspector';
import { CodeInterpreterIdentifier } from './code-interpreter/index';
import { LocalSystemInspectors } from './local-system/Inspector';
import { WebBrowsingInspectors } from './web-browsing/Inspector';
import { WebBrowsingManifest } from './web-browsing/index';

/**
 * Builtin tools inspector registry
 * Organized by toolset (identifier) -> API name
 *
 * Inspector components are used to customize the title/header area
 * of tool calls in the conversation UI.
 */
const BuiltinToolInspectors: Record<string, Record<string, BuiltinInspector>> = {
  [CodeInterpreterIdentifier]: CodeInterpreterInspectors as Record<string, BuiltinInspector>,
  [LocalSystemManifest.identifier]: LocalSystemInspectors as Record<string, BuiltinInspector>,
  [PageAgentIdentifier]: PageAgentInspectors as Record<string, BuiltinInspector>,
  [WebBrowsingManifest.identifier]: WebBrowsingInspectors as Record<string, BuiltinInspector>,
  [GTDManifest.identifier]: GTDInspectors as Record<string, BuiltinInspector>,
};

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

  const toolset = BuiltinToolInspectors[identifier];
  if (!toolset) return undefined;

  return toolset[apiName];
};
