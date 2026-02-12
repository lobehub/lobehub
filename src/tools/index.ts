import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { GTDManifest } from '@lobechat/builtin-tool-gtd';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { NotebookManifest } from '@lobechat/builtin-tool-notebook';
import { PageAgentManifest } from '@lobechat/builtin-tool-page-agent';
import { SkillsManifest } from '@lobechat/builtin-tool-skills';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { isDesktop } from '@lobechat/const';
import { type LobeBuiltinTool } from '@lobechat/types';

/**
 * Default tool IDs that will always be added to the tools list.
 * Shared between frontend (createAgentToolsEngine) and server (createServerAgentToolsEngine).
 */
export const defaultToolIds = [
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  SkillsManifest.identifier,
];

export const builtinTools: LobeBuiltinTool[] = [
  {
    hidden: true,
    identifier: SkillsManifest.identifier,
    manifest: SkillsManifest,
    type: 'builtin',
  },
  {
    hidden: !isDesktop,
    identifier: LocalSystemManifest.identifier,
    manifest: LocalSystemManifest,
    type: 'builtin',
  },
  {
    identifier: MemoryManifest.identifier,
    manifest: MemoryManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: WebBrowsingManifest.identifier,
    manifest: WebBrowsingManifest,
    type: 'builtin',
  },
  {
    identifier: CloudSandboxManifest.identifier,
    manifest: CloudSandboxManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: KnowledgeBaseManifest.identifier,
    manifest: KnowledgeBaseManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: PageAgentManifest.identifier,
    manifest: PageAgentManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: AgentBuilderManifest.identifier,
    manifest: AgentBuilderManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: GroupAgentBuilderManifest.identifier,
    manifest: GroupAgentBuilderManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: GroupManagementManifest.identifier,
    manifest: GroupManagementManifest,
    type: 'builtin',
  },
  {
    identifier: GTDManifest.identifier,
    manifest: GTDManifest,
    type: 'builtin',
  },
  {
    identifier: NotebookManifest.identifier,
    manifest: NotebookManifest,
    type: 'builtin',
  },
];
