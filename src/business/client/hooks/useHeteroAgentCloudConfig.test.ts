import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHeteroAgentCloudConfig } from './useHeteroAgentCloudConfig';

const { mockListForContext, mockProvider } = vi.hoisted(() => ({
  mockListForContext: vi.fn(),
  mockProvider: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDesktop: false,
}));

vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: vi.fn() }) }));

vi.mock('@/hooks/useScopedCreds', () => ({ useCredsForContext: mockListForContext }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => ({ heterogeneousProvider: mockProvider.current }),
  },
}));

describe('useHeteroAgentCloudConfig', () => {
  beforeEach(() => {
    mockProvider.current = { type: 'claude-code' };
    mockListForContext.mockReset();
  });

  it('is not configured when only the agent env references the token', () => {
    mockProvider.current = {
      env: { CLAUDE_CODE_CRED_KEY: 'CLAUDE_CODE_OAUTH_TOKEN' },
      type: 'claude-code',
    };
    mockListForContext.mockReturnValue({ data: [], isLoading: false });

    const { result } = renderHook(() => useHeteroAgentCloudConfig('agt_1'));

    expect(result.current.isConfigured).toBe(false);
  });

  it('is configured when the token exists in the run scope', () => {
    mockListForContext.mockReturnValue({
      data: [{ key: 'CLAUDE_CODE_OAUTH_TOKEN', name: 'Claude Code OAuth Token' }],
      isLoading: false,
    });

    const { result } = renderHook(() => useHeteroAgentCloudConfig('agt_1'));

    expect(result.current.isConfigured).toBe(true);
  });

  it('does not block sending when the credential lookup fails', () => {
    mockListForContext.mockReturnValue({
      data: undefined,
      error: new Error('market unavailable'),
      isLoading: false,
    });

    const { result } = renderHook(() => useHeteroAgentCloudConfig('agt_1'));

    expect(result.current.isConfigured).toBe(true);
  });

  it('does not query credentials for non claude-code providers', () => {
    mockProvider.current = { type: 'codex' };
    mockListForContext.mockReturnValue({ data: undefined, isLoading: false });

    const { result } = renderHook(() => useHeteroAgentCloudConfig('agt_1'));

    expect(result.current.isConfigured).toBe(true);
    expect(mockListForContext).toHaveBeenCalledWith(false);
  });
});
