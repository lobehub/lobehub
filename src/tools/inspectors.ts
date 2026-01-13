import {
  AgentBuilderInspectors,
  AgentBuilderManifest,
} from '@lobechat/builtin-tool-agent-builder/client';
import {
  CloudSandboxIdentifier,
  CloudSandboxInspectors,
} from '@lobechat/builtin-tool-cloud-sandbox/client';
import {
  GroupAgentBuilderInspectors,
  GroupAgentBuilderManifest,
} from '@lobechat/builtin-tool-group-agent-builder/client';
import {
  GroupManagementInspectors,
  GroupManagementManifest,
} from '@lobechat/builtin-tool-group-management/client';
import { GTDInspectors, GTDManifest } from '@lobechat/builtin-tool-gtd/client';
import {
  KnowledgeBaseInspectors,
  KnowledgeBaseManifest,
} from '@lobechat/builtin-tool-knowledge-base/client';
import {
  LocalSystemInspectors,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system/client';
import { NotebookInspectors, NotebookManifest } from '@lobechat/builtin-tool-notebook/client';
import { PageAgentInspectors, PageAgentManifest } from '@lobechat/builtin-tool-page-agent/client';
import {
  WebBrowsingInspectors,
  WebBrowsingManifest,
} from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinInspector } from '@lobechat/types';

/**
 * Builtin tools inspector registry
 * Organized by toolset (identifier) -> API name
 *
 * Inspector components are used to customize the title/header area
 * of tool calls in the conversation UI.
 */
const BuiltinToolInspectors: Record<string, Record<string, BuiltinInspector>> = {
  [AgentBuilderManifest.identifier]: AgentBuilderInspectors as Record<string, BuiltinInspector>,
  [CloudSandboxIdentifier]: CloudSandboxInspectors as Record<string, BuiltinInspector>,
  [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderInspectors as Record<
    string,
    BuiltinInspector
  >,
  [GroupManagementManifest.identifier]: GroupManagementInspectors as Record<
    string,
    BuiltinInspector
  >,
  [GTDManifest.identifier]: GTDInspectors as Record<string, BuiltinInspector>,
  [KnowledgeBaseManifest.identifier]: KnowledgeBaseInspectors as Record<string, BuiltinInspector>,
  [LocalSystemManifest.identifier]: LocalSystemInspectors as Record<string, BuiltinInspector>,
  [NotebookManifest.identifier]: NotebookInspectors as Record<string, BuiltinInspector>,
  [PageAgentManifest.identifier]: PageAgentInspectors as Record<string, BuiltinInspector>,
  [WebBrowsingManifest.identifier]: WebBrowsingInspectors as Record<string, BuiltinInspector>,
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
