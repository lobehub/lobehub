import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import { AgentRuntime, GeneralChatAgent } from '@lobechat/agent-runtime';
import {
  AgentBuilderApiName,
  AgentBuilderIdentifier,
  AgentBuilderManifest,
} from '@lobechat/builtin-tool-agent-builder';
import {
  AgentManagementApiName,
  AgentManagementIdentifier,
  AgentManagementManifest,
} from '@lobechat/builtin-tool-agent-management';
import type { ChatToolPayload, UserInterventionConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

/**
 * `installPlugin` with source `market` installs a connector the agent's later
 * runs call without asking (a listing's tools default to `auto`). The install
 * must therefore wait for the user's approval, which no approval mode waives:
 * a rejected call never reaches the runtime, so nothing is written.
 */
describe('installPlugin approval', () => {
  const cases = [
    {
      apiName: AgentBuilderApiName.installPlugin,
      args: { identifier: 'remote-mcp', source: 'market' },
      identifier: AgentBuilderIdentifier,
      manifest: AgentBuilderManifest,
      name: 'Agent Builder',
    },
    {
      apiName: AgentManagementApiName.installPlugin,
      args: { agentId: 'agt_target', identifier: 'remote-mcp', source: 'market' },
      identifier: AgentManagementIdentifier,
      manifest: AgentManagementManifest,
      name: 'Agent Management',
    },
  ];

  const route = async (
    { apiName, args, identifier, manifest }: (typeof cases)[number],
    userInterventionConfig: UserInterventionConfig,
  ) => {
    const toolCall: ChatToolPayload = {
      apiName,
      arguments: JSON.stringify(args),
      id: 'call_install',
      identifier,
      type: 'builtin',
    };
    const agent = new GeneralChatAgent({
      agentConfig: { maxSteps: 10 },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'op_install',
    });
    const state = AgentRuntime.createInitialState({
      operationId: 'op_install',
      status: 'running',
      toolManifestMap: { [identifier]: manifest as never },
      userInterventionConfig,
    });
    const context: AgentRuntimeContext = {
      payload: {
        hasToolsCalling: true,
        parentMessageId: 'msg_assistant',
        toolsCalling: [toolCall],
      },
      phase: 'llm_result',
      session: { messageCount: 0, sessionId: 'op_install', status: 'running', stepCount: 0 },
    };

    return { instructions: await agent.runner(context, state), toolCall };
  };

  it.each(cases)('$name asks for approval even in auto-run mode', async (testCase) => {
    const { instructions, toolCall } = await route(testCase, { approvalMode: 'auto-run' });

    expect(instructions).toEqual([
      {
        parentMessageId: 'msg_assistant',
        pendingToolsCalling: [toolCall],
        reason: 'human_intervention_required',
        type: 'request_human_approve',
      },
    ]);
  });

  it.each(cases)('$name never installs in a run no one can approve', async (testCase) => {
    const { instructions } = await route(testCase, { approvalMode: 'headless' });

    expect(instructions).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ blockedReason: 'human_intervention_unavailable' }),
        type: 'resolve_blocked_tools',
      }),
    ]);
  });
});
