// agent-builder
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderRenders } from '@lobechat/builtin-tool-agent-builder/client';
// cloud-sandbox
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CloudSandboxRenders } from '@lobechat/builtin-tool-cloud-sandbox/client';
// group-management
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { GroupManagementRenders } from '@lobechat/builtin-tool-group-management/client';
// gtd
import { GTDManifest, GTDRenders } from '@lobechat/builtin-tool-gtd/client';
// local-system
import {
  LocalSystemIdentifier,
  LocalSystemRenders,
} from '@lobechat/builtin-tool-local-system/client';
import { NotebookManifest, NotebookRenders } from '@lobechat/builtin-tool-notebook/client';
// web-browsing
import {
  WebBrowsingManifest,
  WebBrowsingRenders,
} from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinRender } from '@lobechat/types';

// knowledge-base
import { KnowledgeBaseManifest } from './knowledge-base';
import { KnowledgeBaseRenders } from './knowledge-base/Render';

/**
 * Builtin tools renders registry
 * Organized by toolset (identifier) -> API name
 */
const BuiltinToolsRenders: Record<string, Record<string, BuiltinRender>> = {
  [AgentBuilderManifest.identifier]: AgentBuilderRenders as Record<string, BuiltinRender>,
  [CloudSandboxManifest.identifier]: CloudSandboxRenders as Record<string, BuiltinRender>,
  [GroupManagementManifest.identifier]: GroupManagementRenders as Record<string, BuiltinRender>,
  [GTDManifest.identifier]: GTDRenders as Record<string, BuiltinRender>,
  [NotebookManifest.identifier]: NotebookRenders as Record<string, BuiltinRender>,
  [KnowledgeBaseManifest.identifier]: KnowledgeBaseRenders as Record<string, BuiltinRender>,
  [LocalSystemIdentifier]: LocalSystemRenders as Record<string, BuiltinRender>,
  [WebBrowsingManifest.identifier]: WebBrowsingRenders as Record<string, BuiltinRender>,
};

/**
 * Get builtin render component for a specific API
 * @param identifier - Tool identifier (e.g., 'lobe-local-system')
 * @param apiName - API name (e.g., 'searchLocalFiles')
 */
export const getBuiltinRender = (
  identifier?: string,
  apiName?: string,
): BuiltinRender | undefined => {
  if (!identifier) return undefined;

  const toolset = BuiltinToolsRenders[identifier];
  if (!toolset) return undefined;

  if (apiName && toolset[apiName]) {
    return toolset[apiName];
  }

  return undefined;
};
