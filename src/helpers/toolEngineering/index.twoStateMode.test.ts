import { ImageGenerationManifest } from '@lobechat/builtin-tool-image-generation';
import { TaskManifest } from '@lobechat/builtin-tool-task';
import { describe, expect, it, vi } from 'vitest';

import { createAgentToolsEngine } from './index';

vi.mock('@/store/tool', () => ({
  getToolStoreState: () => ({
    agentConnectors: {},
    builtinSkills: [],
    builtinTools: [
      {
        identifier: ImageGenerationManifest.identifier,
        manifest: ImageGenerationManifest,
        type: 'builtin' as const,
      },
      {
        identifier: TaskManifest.identifier,
        manifest: TaskManifest,
        type: 'builtin' as const,
      },
    ],
    composioServers: [],
    connectors: [],
    installedPlugins: [],
    lobehubSkillServers: [],
    uninstalledBuiltinTools: [],
    uninstalledBuiltinToolsReplica: { entries: {} },
  }),
}));
vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({
    activeAgentId: 'agent-1',
    agentMap: { 'agent-1': { chatConfig: {}, plugins: [] } },
  }),
}));
vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelSupportImageOutput: () => () => false,
  },
  getAiInfraStoreState: () => ({}),
}));
vi.mock('@/store/serverConfig', () => ({ getServerConfigStoreState: () => undefined }));
vi.mock('@/store/user', () => ({
  useUserStore: { getState: () => ({}) },
}));
vi.mock('@/store/user/selectors', () => ({
  settingsSelectors: {
    defaultAgentConfig: () => ({ chatConfig: {} }),
    memoryEnabled: () => false,
  },
}));
vi.mock('../getSearchConfig', () => ({
  getSearchConfig: () => ({ useApplicationBuiltinSearchTool: false }),
}));
vi.mock('../isCanUseFC', () => ({ isCanUseFC: () => true }));
vi.mock('../toolAvailability', () => ({ isToolAvailableInCurrentEnv: () => true }));

describe('createAgentToolsEngine two-state mode parity', () => {
  it('invokes an opted-in on-demand builtin in custom mode without requiring a legacy pin', () => {
    const result = createAgentToolsEngine(
      { model: 'gpt-4', provider: 'openai' },
      undefined,
      undefined,
      {
        runAgent: {
          chatConfig: { toolMode: 'custom' },
          plugins: [{ builtinOverride: true, identifier: TaskManifest.identifier, mode: 'auto' }],
        },
        uninstalledBuiltinTools: [],
      },
    ).generateToolsDetailed({
      model: 'gpt-4',
      provider: 'openai',
      toolIds: [],
    });

    expect(result.enabledToolIds).toEqual([TaskManifest.identifier]);
  });

  it('enables image generation in Chat mode when stored as mode auto', () => {
    const result = createAgentToolsEngine(
      { model: 'gpt-4', provider: 'openai' },
      undefined,
      undefined,
      {
        runAgent: {
          chatConfig: { enableAgentMode: false },
          plugins: [
            {
              builtinOverride: true,
              identifier: ImageGenerationManifest.identifier,
              mode: 'auto',
            },
          ],
        },
        uninstalledBuiltinTools: [],
      },
    ).generateToolsDetailed({
      model: 'gpt-4',
      provider: 'openai',
      toolIds: [],
    });

    expect(result.enabledToolIds).toContain(ImageGenerationManifest.identifier);
  });
});
