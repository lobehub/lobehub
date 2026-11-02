// @vitest-environment node
import { MessagesEngine } from '@lobechat/context-engine';
import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { createServerAgentToolsEngine } from '../../AgentToolsEngine';
import { type InstalledPlugin } from '../../AgentToolsEngine/types';

const AT = 1_700_000_000_000;
const SYSTEM_ROLE = 'You are the contract-test agent. Keep this sentence byte-for-byte unchanged.';

const installedPlugins: InstalledPlugin[] = [
  {
    identifier: 'fixture-plugin',
    manifest: {
      api: [
        {
          description: 'Read the fixture record.',
          name: 'read',
          parameters: {
            properties: { id: { type: 'string' } },
            required: ['id'],
            type: 'object',
          },
        },
        {
          description: 'Update the fixture record.',
          name: 'update',
          parameters: {
            properties: { id: { type: 'string' }, value: { type: 'string' } },
            required: ['id', 'value'],
            type: 'object',
          },
        },
      ],
      identifier: 'fixture-plugin',
      meta: { description: 'Deterministic plugin fixture', title: 'Fixture Plugin' },
      systemRole: 'Use fixture-plugin only for deterministic contract tests.',
      type: 'default',
    },
    runtimeType: 'default',
    type: 'plugin',
  },
];

const messages: UIChatMessage[] = [
  {
    content: 'hello',
    createdAt: AT,
    id: 'fixture-user-message',
    role: 'user',
    updatedAt: AT,
  } as UIChatMessage,
];

const modes = {
  agent: { enableAgentMode: true },
  chat: { enableAgentMode: false },
  custom: { enableAgentMode: true, toolMode: 'custom' as const },
};

const buildContract = async (mode: keyof typeof modes) => {
  const chatConfig = modes[mode];
  const toolsEngine = createServerAgentToolsEngine(
    {
      installedPlugins,
      isModelSupportToolUse: () => true,
    },
    {
      agentConfig: {
        chatConfig,
        plugins: ['fixture-plugin'],
      },
      canUseDevice: false,
      globalMemoryEnabled: true,
      hasEnabledKnowledgeBases: true,
      model: 'gpt-4',
      provider: 'openai',
    },
  );

  const tools = toolsEngine.generateToolsDetailed({
    model: 'gpt-4',
    provider: 'openai',
    toolIds: ['fixture-plugin'],
  });

  const result = await new MessagesEngine({
    capabilities: { isCanUseFC: () => true },
    enableAgentMode: chatConfig.enableAgentMode,
    enableSystemDate: false,
    messages,
    model: 'gpt-4',
    promptMode: 'full',
    provider: 'openai',
    systemRole: SYSTEM_ROLE,
    toolsConfig: {
      manifests: tools.enabledManifests,
      tools: tools.enabledToolIds,
    },
  }).process();

  return {
    access: {
      canUseDevice: false,
      filteredTools: tools.filteredTools,
    },
    enabledToolIds: tools.enabledToolIds,
    manifestMetadata: tools.enabledManifests.map((manifest) => ({
      apiNames: manifest.api.map((api) => api.name),
      identifier: manifest.identifier,
      title: manifest.meta?.title,
      type: manifest.type,
    })),
    messages: result.messages,
    metadata: {
      contextBuckets: result.metadata.contextBuckets,
      toolSystemRole: result.metadata.toolSystemRole,
    },
    systemRole: SYSTEM_ROLE,
    toolNames: tools.tools?.map((tool) => tool.function.name),
  };
};

describe('legacy chat/agent/custom mode contract', () => {
  it('freezes the old modes before contextMode is introduced', async () => {
    const contract = {
      agent: await buildContract('agent'),
      chat: await buildContract('chat'),
      custom: await buildContract('custom'),
    };

    expect(contract).toMatchSnapshot();
  });
});
