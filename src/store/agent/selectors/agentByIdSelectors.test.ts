import { afterEach, describe, expect, it, vi } from 'vitest';

import { globalAgentContextManager } from '@/helpers/GlobalAgentContextManager';
import { type AgentStoreState } from '@/store/agent/initialState';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';
import { initialBuiltinAgentSliceState } from '@/store/agent/slices/builtin/initialState';

import { agentByIdSelectors } from './agentByIdSelectors';

// getAgentWorkingDirectoryById is desktop-only; force the desktop branch on.
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal()),
  isDesktop: true,
}));

const createState = (overrides: Partial<AgentStoreState> = {}): AgentStoreState => ({
  ...initialAgentSliceState,
  ...initialBuiltinAgentSliceState,
  ...overrides,
});

describe('agentByIdSelectors', () => {
  describe('getAgentBuilderContextById', () => {
    it('should return builder context from existing agent config', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { historyCount: 6 },
            model: 'gpt-4o',
            plugins: ['search'],
            provider: 'openai',
            systemRole: 'You are a helper',
          },
        },
      });

      const context = agentByIdSelectors.getAgentBuilderContextById('agent-1')(state);

      expect(context.config).toMatchObject({
        chatConfig: { historyCount: 6 },
        model: 'gpt-4o',
        plugins: ['search'],
        provider: 'openai',
        systemRole: 'You are a helper',
      });
    });

    it('should not throw when agent config is missing', () => {
      const state = createState({ agentMap: {} });

      expect(() =>
        agentByIdSelectors.getAgentBuilderContextById('missing-agent')(state),
      ).not.toThrow();

      const context = agentByIdSelectors.getAgentBuilderContextById('missing-agent')(state);

      expect(context.config).toMatchObject({
        chatConfig: undefined,
        model: undefined,
        plugins: undefined,
        provider: undefined,
        systemRole: undefined,
      });
    });
  });

  describe('agent mode', () => {
    it('should default to agent mode when enableAgentMode is not explicitly false', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: {},
            model: 'gpt-4o',
            provider: 'openai',
          },
        },
      });

      expect(agentByIdSelectors.getAgentModeById('agent-1')(state)).toBe('auto');
      expect(agentByIdSelectors.getAgentEnableModeById('agent-1')(state)).toBe(true);
    });

    it('should keep fable in agent mode when agent mode is enabled', () => {
      const state = createState({
        agentMap: {
          'agent-1': {
            chatConfig: { enableAgentMode: true },
            model: 'claude-fable-5',
            provider: 'lobehub',
          },
        },
      });

      expect(agentByIdSelectors.getAgentModeById('agent-1')(state)).toBe('auto');
      expect(agentByIdSelectors.getAgentEnableModeById('agent-1')(state)).toBe(true);
    });
  });

  describe('getAgentWorkingDirectoryById', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const stateWith = (config: Record<string, any>, localMap: Record<string, string> = {}) =>
      createState({
        agentMap: { 'agent-1': config },
        localAgentWorkingDirectoryMap: localMap,
      });

    it('reads the per-device choice for the current (local) device', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({
        agencyConfig: { workingDirByDevice: { 'device-A': '/repos/agent-gateway' } },
      });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/agent-gateway',
      );
    });

    it('reads the bound device choice when the agent targets a device', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({
        agencyConfig: {
          boundDeviceId: 'device-B',
          executionTarget: 'device',
          workingDirByDevice: { 'device-A': '/repos/local', 'device-B': '/repos/remote' },
        },
      });

      // currentDeviceId is the local machine, but executionTarget=device → device-B wins
      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/remote',
      );
    });

    it('falls back to the legacy per-agent value when no device choice exists', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({ homePath: '/home/me' });
      const state = stateWith({ agencyConfig: {} }, { 'agent-1': '/repos/legacy' });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/repos/legacy',
      );
    });

    it('falls back to desktop/home path when nothing is set', () => {
      vi.spyOn(globalAgentContextManager, 'getContext').mockReturnValue({
        desktopPath: '/home/me/Desktop',
        homePath: '/home/me',
      });
      const state = stateWith({ agencyConfig: {} });

      expect(agentByIdSelectors.getAgentWorkingDirectoryById('agent-1', 'device-A')(state)).toBe(
        '/home/me/Desktop',
      );
    });
  });
});
