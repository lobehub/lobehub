// @vitest-environment node
import { AgentAccountIdentifier } from '@lobechat/builtin-tool-agent-account';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { resolveInvocationToolIds } from '@lobechat/mecha';
import { describe, expect, it } from 'vitest';

import { INBOX_RUN_PLUGIN_IDS } from '@/server/services/agentIdentity/ownerChannel';

import { createServerAgentToolsEngine } from '../index';
import type { ServerAgentToolsContext } from '../types';

const context: ServerAgentToolsContext = {
  installedPlugins: [],
  isModelSupportToolUse: () => true,
};

/** The tools a run gets, deciding exactly as the discovery stage does for an exclusive run. */
const toolsOf = (hasIdentityAccount: boolean) =>
  createServerAgentToolsEngine(context, {
    agentConfig: {
      // Pinned by the owner, and enough on their own to carry data out.
      plugins: [WebBrowsingManifest.identifier, MemoryManifest.identifier],
    },
    hasIdentityAccount,
    model: 'gpt-4',
    provider: 'openai',
  }).generateToolsDetailed({
    model: 'gpt-4',
    provider: 'openai',
    skipDefaultTools: true,
    toolIds: resolveInvocationToolIds({
      agentPlugins: INBOX_RUN_PLUGIN_IDS,
      exclusivePluginIds: INBOX_RUN_PLUGIN_IDS,
    }),
  });

describe('the tools of a mail-woken run', () => {
  it("is the agent's mailbox and nothing the owner pinned or the engine defaults to", () => {
    expect(toolsOf(true).enabledToolIds).toEqual([AgentAccountIdentifier]);
  });

  it('is nothing at all for an agent without an account', () => {
    expect(toolsOf(false).enabledToolIds).toEqual([]);
  });
});
