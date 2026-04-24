import {
  LobeActivatorManifest,
  LobeActivatorRenders,
} from '@lobechat/builtin-tool-activator/client';
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderRenders } from '@lobechat/builtin-tool-agent-builder/client';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AgentDocumentsRenders } from '@lobechat/builtin-tool-agent-documents/client';
import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import { AgentManagementRenders } from '@lobechat/builtin-tool-agent-management/client';
import { ClaudeCodeIdentifier, ClaudeCodeRenders } from '@lobechat/builtin-tool-claude-code/client';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { CloudSandboxRenders } from '@lobechat/builtin-tool-cloud-sandbox/client';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderRenders } from '@lobechat/builtin-tool-group-agent-builder/client';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { GroupManagementRenders } from '@lobechat/builtin-tool-group-management/client';
import { GTDManifest, GTDRenders } from '@lobechat/builtin-tool-gtd/client';
import {
  KnowledgeBaseManifest,
  KnowledgeBaseRenders,
} from '@lobechat/builtin-tool-knowledge-base/client';
import {
  LocalSystemManifest,
  LocalSystemRenders,
} from '@lobechat/builtin-tool-local-system/client';
import { MemoryManifest, MemoryRenders } from '@lobechat/builtin-tool-memory/client';
import { MessageManifest, MessageRenders } from '@lobechat/builtin-tool-message/client';
import { NotebookManifest, NotebookRenders } from '@lobechat/builtin-tool-notebook/client';
import { SkillStoreManifest, SkillStoreRenders } from '@lobechat/builtin-tool-skill-store/client';
import { SkillsManifest, SkillsRenders } from '@lobechat/builtin-tool-skills/client';
import {
  WebBrowsingManifest,
  WebBrowsingRenders,
} from '@lobechat/builtin-tool-web-browsing/client';
import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import { type BuiltinRender } from '@lobechat/types';

import { CodexRenders } from './codex';

export interface BuiltinRenderRegistryEntry {
  apiName: string;
  identifier: string;
  render: BuiltinRender;
}

/**
 * Builtin tools renders registry
 * Organized by toolset (identifier) -> API name
 */
const BuiltinToolsRenders: Record<string, Record<string, BuiltinRender>> = {
  [AgentBuilderManifest.identifier]: AgentBuilderRenders as Record<string, BuiltinRender>,
  [AgentDocumentsManifest.identifier]: AgentDocumentsRenders as Record<string, BuiltinRender>,
  [AgentManagementManifest.identifier]: AgentManagementRenders as Record<string, BuiltinRender>,
  [ClaudeCodeIdentifier]: ClaudeCodeRenders as Record<string, BuiltinRender>,
  [CloudSandboxManifest.identifier]: CloudSandboxRenders as Record<string, BuiltinRender>,
  [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderRenders as Record<string, BuiltinRender>,
  [GroupManagementManifest.identifier]: GroupManagementRenders as Record<string, BuiltinRender>,
  [GTDManifest.identifier]: GTDRenders as Record<string, BuiltinRender>,
  [KnowledgeBaseManifest.identifier]: KnowledgeBaseRenders as Record<string, BuiltinRender>,
  [LocalSystemManifest.identifier]: LocalSystemRenders as Record<string, BuiltinRender>,
  [MemoryManifest.identifier]: MemoryRenders as Record<string, BuiltinRender>,
  [MessageManifest.identifier]: MessageRenders as Record<string, BuiltinRender>,
  [NotebookManifest.identifier]: NotebookRenders as Record<string, BuiltinRender>,
  [SkillStoreManifest.identifier]: SkillStoreRenders as Record<string, BuiltinRender>,
  [SkillsManifest.identifier]: SkillsRenders as Record<string, BuiltinRender>,
  [LobeActivatorManifest.identifier]: LobeActivatorRenders as Record<string, BuiltinRender>,
  // @deprecated backward compat: old messages stored 'lobe-tools' as identifier
  ['lobe-tools']: LobeActivatorRenders as Record<string, BuiltinRender>,
  [WebBrowsingManifest.identifier]: WebBrowsingRenders as Record<string, BuiltinRender>,
  codex: {
    ...CodexRenders,
    command_execution: RunCommandRender as BuiltinRender,
  },
};

export const listBuiltinRenderEntries = (): BuiltinRenderRegistryEntry[] =>
  Object.entries(BuiltinToolsRenders).flatMap(([identifier, toolset]) =>
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

export { getBuiltinRenderDisplayControl } from './displayControls';
