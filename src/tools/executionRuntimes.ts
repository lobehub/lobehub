import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-agent-builder/executionRuntime';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupAgentBuilderExecutionRuntime } from '@lobechat/builtin-tool-group-agent-builder/executionRuntime';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { WebBrowsingExecutionRuntime } from '@lobechat/builtin-tool-web-browsing/executionRuntime';

// Note: KnowledgeBase and LocalSystem now use executor pattern via toolStore/builtin/executors

export const BuiltinToolServerRuntimes: Record<string, any> = {
  [AgentBuilderManifest.identifier]: AgentBuilderExecutionRuntime,
  [GroupAgentBuilderManifest.identifier]: GroupAgentBuilderExecutionRuntime,
  [WebBrowsingManifest.identifier]: WebBrowsingExecutionRuntime,
};
