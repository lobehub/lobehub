import * as builtinAgents from '@lobechat/builtin-agents';
import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { GroupManagementIdentifier } from '@lobechat/builtin-tool-group-management';
import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import { TaskIdentifier } from '@lobechat/builtin-tool-task';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AgentProjectionInput,
  getProjectionStoreState,
  useProjectionStore,
} from '@/projection';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { resolveAgentConfig } from './agentConfigResolver';

const SCOPE = 'test-user:personal';
const TEST_AGENT_ID = 'test-agent';

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getCacheScope: () => SCOPE,
  useCacheScope: () => SCOPE,
}));

const baseAgent = (id: string): AgentProjectionInput => ({
  chatConfig: { enableStreaming: true },
  id,
  model: 'gpt-4',
  plugins: ['plugin-a', 'plugin-b'],
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
});

const seedAgent = (id: string, overrides: Partial<AgentProjectionInput> = {}) => {
  getProjectionStoreState().commitAgentConfig(
    SCOPE,
    { ...baseAgent(id), ...overrides, id },
    'full',
    'mutation',
  );
};

describe('resolveAgentConfig', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectionStore.setState({ scopes: {} });
    useUserStore.setState({ user: undefined, workspaceUserPreference: {} });
    vi.spyOn(userGeneralSettingsSelectors, 'currentResponseLanguage').mockReturnValue(
      undefined as never,
    );
    seedAgent(TEST_AGENT_ID);
  });

  describe('regular agent', () => {
    it('resolves configuration directly from the Agent Projection', () => {
      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID });

      expect(result).toMatchObject({
        agentConfig: {
          model: 'gpt-4',
          plugins: ['plugin-a', 'plugin-b'],
          provider: 'openai',
          systemRole: 'You are a helpful assistant',
        },
        chatConfig: { enableStreaming: true },
        isBuiltinAgent: false,
        plugins: ['plugin-a', 'plugin-b'],
      });
    });

    it('fails explicitly when a full Agent Projection has not landed', () => {
      expect(() => resolveAgentConfig({ agentId: 'missing-agent' })).toThrow(
        'Agent config is not projected: missing-agent',
      );
    });

    it('treats an unknown slug as a regular agent', () => {
      seedAgent(TEST_AGENT_ID, { slug: 'custom-agent-slug' });

      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID });

      expect(result.isBuiltinAgent).toBe(false);
      expect(result.slug).toBeUndefined();
    });

    it('keeps pinned plugins and excludes disabled entries', () => {
      seedAgent(TEST_AGENT_ID, {
        plugins: [
          'plugin-a',
          { identifier: 'plugin-b', mode: 'disabled' },
          { identifier: 'plugin-c', mode: 'pinned' },
        ],
      });

      expect(resolveAgentConfig({ agentId: TEST_AGENT_ID }).plugins).toEqual([
        'plugin-a',
        'plugin-c',
      ]);
    });

    it('uses member model and mode preferences for a public workspace Agent', () => {
      seedAgent(TEST_AGENT_ID, {
        agencyConfig: { modelSelectionPolicy: 'member' },
        chatConfig: { enableAgentMode: true, enableStreaming: true },
        userId: 'author-1',
        visibility: 'public',
        workspaceId: 'workspace-1',
      });
      useUserStore.setState({
        user: { id: 'member-1' } as any,
        workspaceUserPreference: {
          agentModeOverrides: { [TEST_AGENT_ID]: false },
          agentModelOverrides: {
            [TEST_AGENT_ID]: { model: 'member-model', provider: 'member-provider' },
          },
        },
      });

      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID });

      expect(result.agentConfig).toMatchObject({
        model: 'member-model',
        provider: 'member-provider',
      });
      expect(result.chatConfig).toMatchObject({ enableAgentMode: false, enableStreaming: true });
    });

    it('ignores member preferences for the workspace Agent author', () => {
      seedAgent(TEST_AGENT_ID, {
        agencyConfig: { modelSelectionPolicy: 'member' },
        chatConfig: { enableAgentMode: true },
        userId: 'author-1',
        visibility: 'public',
        workspaceId: 'workspace-1',
      });
      useUserStore.setState({
        user: { id: 'author-1' } as any,
        workspaceUserPreference: {
          agentModeOverrides: { [TEST_AGENT_ID]: false },
          agentModelOverrides: {
            [TEST_AGENT_ID]: { model: 'member-model', provider: 'member-provider' },
          },
        },
      });

      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID });

      expect(result.agentConfig).toMatchObject({ model: 'gpt-4', provider: 'openai' });
      expect(result.chatConfig.enableAgentMode).toBe(true);
    });

    it('only exposes gated model parameters and does not mutate the projected config', () => {
      seedAgent(TEST_AGENT_ID, {
        chatConfig: { enableMaxTokens: true, enableReasoningEffort: false },
        params: { max_tokens: 4096, reasoning_effort: 'high', temperature: 0.7 },
      });
      const projectedParams =
        getProjectionStoreState().scopes[SCOPE].records.agent[TEST_AGENT_ID].fragments.configuration
          ?.data.params;

      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID });

      expect(result.agentConfig.params).toEqual({
        max_tokens: 4096,
        reasoning_effort: undefined,
        temperature: 0.7,
      });
      expect(projectedParams).toEqual({
        max_tokens: 4096,
        reasoning_effort: 'high',
        temperature: 0.7,
      });
    });

    it('injects the response-language instruction after the Agent system role', () => {
      vi.spyOn(userGeneralSettingsSelectors, 'currentResponseLanguage').mockReturnValue('zh-CN');

      expect(resolveAgentConfig({ agentId: TEST_AGENT_ID }).agentConfig.systemRole).toBe(
        'You are a helpful assistant\n\nPreferred reply language: zh-CN. Use this language unless the user explicitly asks to switch.',
      );
    });
  });

  describe('builtin agent', () => {
    beforeEach(() => {
      seedAgent('builtin-agent', { slug: BUILTIN_AGENT_SLUGS.agentBuilder, virtual: true });
    });

    it('merges runtime system role, plugins, chat config, and agency config', () => {
      seedAgent('builtin-agent', {
        agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'device' },
        chatConfig: { enableHistoryCount: true, enableStreaming: true, historyCount: 20 },
        slug: BUILTIN_AGENT_SLUGS.agentBuilder,
        virtual: true,
      });
      vi.spyOn(builtinAgents, 'getAgentRuntimeConfig').mockReturnValue({
        agencyConfig: { executionTarget: 'none' },
        chatConfig: { enableHistoryCount: false },
        plugins: ['runtime-plugin'],
        systemRole: 'Runtime system role',
      });

      const result = resolveAgentConfig({ agentId: 'builtin-agent' });

      expect(result).toMatchObject({
        agentConfig: {
          agencyConfig: { boundDeviceId: 'device-a', executionTarget: 'none' },
          systemRole: 'Runtime system role',
        },
        chatConfig: { enableHistoryCount: false, enableStreaming: true, historyCount: 20 },
        isBuiltinAgent: true,
        plugins: ['runtime-plugin'],
        slug: BUILTIN_AGENT_SLUGS.agentBuilder,
      });
    });

    it('falls back to projected plugins and system role when runtime omits them', () => {
      vi.spyOn(builtinAgents, 'getAgentRuntimeConfig').mockReturnValue({
        plugins: [],
        systemRole: undefined as never,
      });

      const result = resolveAgentConfig({ agentId: 'builtin-agent' });

      expect(result.plugins).toEqual(['plugin-a', 'plugin-b']);
      expect(result.agentConfig.systemRole).toBe('You are a helpful assistant');
    });

    it('passes projected plugins and invocation context to the runtime', () => {
      const runtimeSpy = vi
        .spyOn(builtinAgents, 'getAgentRuntimeConfig')
        .mockReturnValue({ plugins: ['runtime-plugin'], systemRole: 'Runtime system role' });

      resolveAgentConfig({
        agentId: 'builtin-agent',
        documentContent: 'document',
        model: 'runtime-model',
        targetAgentConfig: { model: 'target-model' } as never,
      });

      expect(runtimeSpy).toHaveBeenCalledWith(
        BUILTIN_AGENT_SLUGS.agentBuilder,
        expect.objectContaining({
          documentContent: 'document',
          model: 'runtime-model',
          plugins: ['plugin-a', 'plugin-b'],
          targetAgentConfig: { model: 'target-model' },
        }),
      );
    });
  });

  describe('execution scopes', () => {
    it('injects page-agent capabilities only in page scope', () => {
      vi.spyOn(builtinAgents, 'getAgentRuntimeConfig').mockImplementation((slug) =>
        slug === BUILTIN_AGENT_SLUGS.pageAgent ? { systemRole: 'Page agent role' } : undefined,
      );

      const pageResult = resolveAgentConfig({ agentId: TEST_AGENT_ID, scope: 'page' });
      const mainResult = resolveAgentConfig({
        agentId: TEST_AGENT_ID,
        plugins: [PageAgentIdentifier, 'plugin-a'],
        scope: 'main',
      });

      expect(pageResult.plugins).toEqual([PageAgentIdentifier, 'plugin-a', 'plugin-b']);
      expect(pageResult.agentConfig.systemRole).toContain('Page agent role');
      expect(pageResult.chatConfig.enableHistoryCount).toBe(false);
      expect(mainResult.plugins).toEqual(['plugin-a']);
    });

    it('injects task capabilities in task scope without duplication', () => {
      seedAgent(TEST_AGENT_ID, { plugins: [TaskIdentifier, 'plugin-a'] });
      vi.spyOn(builtinAgents, 'getAgentRuntimeConfig').mockImplementation((slug) =>
        slug === BUILTIN_AGENT_SLUGS.taskAgent ? { systemRole: 'Task agent role' } : undefined,
      );

      const result = resolveAgentConfig({ agentId: TEST_AGENT_ID, scope: 'task' });

      expect(result.plugins).toEqual([TaskIdentifier, 'plugin-a']);
      expect(result.agentConfig.systemRole).toContain('Task agent role');
    });

    it('keeps lobe-agent for sub-agent execution but disableTools takes precedence', () => {
      seedAgent(TEST_AGENT_ID, { plugins: [LobeAgentIdentifier, 'plugin-a'] });

      expect(resolveAgentConfig({ agentId: TEST_AGENT_ID, isSubAgent: true }).plugins).toEqual([
        LobeAgentIdentifier,
        'plugin-a',
      ]);
      expect(
        resolveAgentConfig({ agentId: TEST_AGENT_ID, disableTools: true, isSubAgent: true })
          .plugins,
      ).toEqual([]);
    });
  });

  describe('group supervisor', () => {
    it('derives supervisor identity and member context from ChatGroup Projection', () => {
      const supervisorId = 'supervisor-agent';
      const memberId = 'member-agent';
      getProjectionStoreState().commitChatGroupDetail(
        SCOPE,
        {
          agents: [
            { ...baseAgent(supervisorId), isSupervisor: true, title: 'Supervisor' },
            { ...baseAgent(memberId), isSupervisor: false, title: 'Member' },
          ],
          config: {},
          id: 'group-1',
          supervisorAgentId: supervisorId,
          title: 'Research Group',
        } as any,
        { group: 'full', members: { [memberId]: 'full', [supervisorId]: 'full' } },
        'mutation',
      );
      const runtimeSpy = vi.spyOn(builtinAgents, 'getAgentRuntimeConfig').mockReturnValue({
        plugins: [GroupManagementIdentifier],
        systemRole: 'Supervisor runtime role',
      });

      const result = resolveAgentConfig({
        agentId: supervisorId,
        groupId: 'group-1',
        scope: 'group',
      });

      expect(result).toMatchObject({
        isBuiltinAgent: true,
        plugins: [GroupManagementIdentifier],
        slug: BUILTIN_AGENT_SLUGS.groupSupervisor,
      });
      expect(runtimeSpy).toHaveBeenCalledWith(
        BUILTIN_AGENT_SLUGS.groupSupervisor,
        expect.objectContaining({
          groupSupervisorContext: {
            availableAgents: [{ id: memberId, title: 'Member' }],
            groupId: 'group-1',
            groupTitle: 'Research Group',
            systemPrompt: 'You are a helpful assistant',
          },
        }),
      );
    });
  });
});
