/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CCCompatibleProvidersResult } from '@/features/Electron/HeterogeneousAgent/hooks/useClaudeCodeCompatibleProviders';

import ApiModeModelBar from './ApiModeModelBar';

const { mockState, useCompatibleProviders } = vi.hoisted(() => ({
  mockState: {
    agentMap: {} as Record<string, any>,
    updateAgentConfigById: vi.fn(),
  },
  useCompatibleProviders: vi.fn<() => CCCompatibleProvidersResult>(() => ({
    modelsByProvider: {},
    providers: [],
  })),
}));

vi.mock('@/features/Electron/HeterogeneousAgent/hooks/useClaudeCodeCompatibleProviders', () => ({
  useClaudeCodeCompatibleProviders: useCompatibleProviders,
}));

vi.mock('@/features/ModelSelect', () => ({
  default: ({
    providerIds,
    value,
  }: {
    providerIds?: string[];
    value?: { model: string; provider?: string };
  }) => (
    <div
      data-provider-ids={(providerIds ?? []).join(',')}
      data-testid="api-mode-model-select"
      data-value={`${value?.provider ?? ''}/${value?.model ?? ''}`}
    />
  ),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: (agentId: string) => (state: typeof mockState) =>
      state.agentMap[agentId]?.agencyConfig,
  },
}));

beforeEach(() => {
  mockState.agentMap = {
    agent1: {
      agencyConfig: {
        heterogeneousProvider: {
          apiConfig: {
            model: 'claude-sonnet-4-5',
            providerId: 'anthropic',
          },
          authMode: 'api',
          type: 'claude-code',
        },
      },
    },
  };
  mockState.updateAgentConfigById.mockReset();
  useCompatibleProviders.mockReturnValue({ modelsByProvider: {}, providers: [] });
});

describe('ApiModeModelBar', () => {
  it('does not render when API mode has no compatible provider', () => {
    render(<ApiModeModelBar agentId="agent1" />);

    expect(screen.queryByTestId('api-mode-model-select')).toBeNull();
  });

  it('restricts the model picker to compatible providers', () => {
    useCompatibleProviders.mockReturnValue({
      modelsByProvider: {},
      providers: [{ id: 'anthropic', name: 'Anthropic' }],
    });

    render(<ApiModeModelBar agentId="agent1" />);

    const select = screen.getByTestId('api-mode-model-select');
    expect(select.getAttribute('data-provider-ids')).toBe('anthropic');
    expect(select.getAttribute('data-value')).toBe('anthropic/claude-sonnet-4-5');
  });
});
