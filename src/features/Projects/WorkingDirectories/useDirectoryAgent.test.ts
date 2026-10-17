import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { directoryAgentName, useDirectoryAgent } from './useDirectoryAgent';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Lobe AI' }) }));
vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: { inboxAgentId: () => 'inbox-agent' },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: {
    getAgentById: (id: string) => () =>
      id === 'selected-agent' ? { title: 'Selected Agent' } : undefined,
  },
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({ agentMap: {} }),
}));

describe('useDirectoryAgent', () => {
  it('uses list metadata for the selected agent before its detail has been loaded', () => {
    const { result } = renderHook(() => useDirectoryAgent('coordinator'));
    expect(result.current.agentId).toBe('coordinator');
    act(() => result.current.setAgentId('selected-agent'));
    expect(result.current.agentId).toBe('selected-agent');
    expect(result.current.agentName).toBe('Selected Agent');
  });
});

it('labels the built-in agent without a stored title and honors custom display names', () => {
  expect(directoryAgentName({ title: null }, true, 'Lobe AI')).toBe('Lobe AI');
  expect(directoryAgentName({ name: 'Designer', title: 'Old title' }, false, 'Lobe AI')).toBe(
    'Designer',
  );
  const { result } = renderHook(() => useDirectoryAgent('coordinator'));
  act(() => result.current.setAgentId('inbox-agent'));
  expect(result.current.agentName).toBe('Lobe AI');
});
