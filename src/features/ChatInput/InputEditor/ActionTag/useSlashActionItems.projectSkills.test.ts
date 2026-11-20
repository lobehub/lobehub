import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSlashActionItems } from './useSlashActionItems';

const state = vi.hoisted(() => ({
  /** `undefined`: the host publishes no topic; `null`: its conversation has none. */
  composerTopicId: undefined as string | null | undefined,
  useFetchProjectSkills: vi.fn(() => ({ data: undefined })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (selector: (s: object) => unknown) =>
    selector({ agentId: 'agent-1', editor: undefined, topicId: state.composerTopicId }),
}));

vi.mock('@/helpers/gatewayMode', () => ({ useIsGatewayModeEnabled: () => true }));

// The main column's topic runs in the cloud sandbox; the side-by-side pane's
// topic is pinned to a device.
vi.mock('@/hooks/useEffectiveAgencyConfig', () => ({
  useEffectiveAgencyConfig: (_agentId: string, options?: { topicId?: string | null }) => ({
    agencyConfig:
      options?.topicId === 'pane-topic'
        ? {
            boundDeviceId: 'pane-device',
            executionTarget: 'device',
            heterogeneousProvider: { type: 'codex' },
          }
        : { executionTarget: 'sandbox', heterogeneousProvider: { type: 'codex' } },
    workspaceScoped: false,
  }),
}));

vi.mock('@/hooks/useEffectiveWorkingDirectory', () => ({
  useEffectiveWorkingDirectory: () => '/repo/pane',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) => selector({ agentMap: {} }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => ({ executionTarget: 'sandbox' }),
    isAgentHeterogeneousById: () => () => true,
    isWorkspaceAgentById: () => () => false,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: object) => unknown) => selector({ activeTopicId: 'main-topic' }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (s: object) => unknown) =>
    selector({
      useFetchAgentDocumentSkills: () => undefined,
      useFetchProjectSkills: state.useFetchProjectSkills,
    }),
}));

vi.mock('@/store/tool/selectors', () => ({
  agentDocumentSkillsSelectors: { getAgentDocumentSkills: () => () => [] },
  projectSkillsSelectors: { getProjectSkills: () => () => undefined },
}));

vi.mock('./useInstalledSkillsAndTools', () => ({ useInstalledSkillsAndTools: () => [] }));

beforeEach(() => {
  state.composerTopicId = undefined;
  state.useFetchProjectSkills.mockClear();
});

describe('useSlashActionItems · project skills', () => {
  it("scans project skills on the device the composer's own topic is pinned to", () => {
    state.composerTopicId = 'pane-topic';

    renderHook(() => useSlashActionItems());

    expect(state.useFetchProjectSkills).toHaveBeenLastCalledWith('/repo/pane', 'pane-device');
  });
});
