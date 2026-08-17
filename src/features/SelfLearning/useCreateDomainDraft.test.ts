import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseStoredCreateDraft, useCreateDomainDraft } from './useCreateDomainDraft';

interface HookProps {
  agentId?: string;
}

describe('useCreateDomainDraft', () => {
  beforeEach(() => localStorage.clear());

  it('migrates the legacy plain-text brief', () => {
    expect(parseStoredCreateDraft('Improve production incident response')).toEqual({
      brief: 'Improve production incident response',
    });
  });

  it('rehydrates when the routed agent becomes available without deleting its draft', async () => {
    const storageKey = 'self-learning:create:agent_1';
    const initialProps: HookProps = {};
    localStorage.setItem(storageKey, JSON.stringify({ brief: 'Saved agent draft' }));

    const { rerender, result } = renderHook(
      ({ agentId }: HookProps) => useCreateDomainDraft(agentId),
      {
        initialProps,
      },
    );

    rerender({ agentId: 'agent_1' });

    await waitFor(() => expect(result.current.brief).toBe('Saved agent draft'));
    expect(localStorage.getItem(storageKey)).toContain('Saved agent draft');

    act(() => result.current.setBrief('Updated agent draft'));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toContain('Updated agent draft'));
  });

  it('clears the in-progress draft and its persisted copy', async () => {
    const storageKey = 'self-learning:create:agent_1';
    const { result } = renderHook(() => useCreateDomainDraft('agent_1'));

    act(() => result.current.setBrief('Draft to discard'));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toContain('Draft to discard'));

    act(() => result.current.clearDraft());

    expect(result.current.brief).toBe('');
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  });
});
