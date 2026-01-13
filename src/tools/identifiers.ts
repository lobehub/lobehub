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
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';

import { ArtifactsManifest } from './artifacts';

export const builtinToolIdentifiers: string[] = [
  AgentBuilderManifest.identifier,
  ArtifactsManifest.identifier,
  LocalSystemManifest.identifier,
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  CloudSandboxManifest.identifier,
  PageAgentManifest.identifier,
  GroupAgentBuilderManifest.identifier,
  GroupManagementManifest.identifier,
  GTDManifest.identifier,
  MemoryManifest.identifier,
  NotebookManifest.identifier,
];
