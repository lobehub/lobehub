import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  prefersTemporarySandbox,
  setPrefersTemporarySandbox,
  TEMPORARY_SANDBOX_PREFERENCE_KEY,
  usePrefersTemporarySandbox,
} from './temporarySandboxPreference';

afterEach(() => {
  localStorage.removeItem(TEMPORARY_SANDBOX_PREFERENCE_KEY);
});

describe('temporarySandboxPreference', () => {
  it('is off until the temporary sandbox is picked', () => {
    expect(prefersTemporarySandbox(null, 'agent-1')).toBe(false);

    setPrefersTemporarySandbox(null, 'agent-1', true);
    expect(prefersTemporarySandbox(null, 'agent-1')).toBe(true);

    setPrefersTemporarySandbox(null, 'agent-1', false);
    expect(prefersTemporarySandbox(null, 'agent-1')).toBe(false);
  });

  it('keeps each workspace and agent apart', () => {
    setPrefersTemporarySandbox('ws_1', 'agent-1', true);

    expect(prefersTemporarySandbox(null, 'agent-1')).toBe(false);
    expect(prefersTemporarySandbox('ws_1', 'agent-2')).toBe(false);
    expect(prefersTemporarySandbox('ws_1', 'agent-1')).toBe(true);
  });

  it('reads a corrupted store as nothing remembered', () => {
    localStorage.setItem(TEMPORARY_SANDBOX_PREFERENCE_KEY, '[not json');

    expect(prefersTemporarySandbox(null, 'agent-1')).toBe(false);
  });

  it('re-renders a reader when another component writes', () => {
    const { result } = renderHook(() => usePrefersTemporarySandbox(null, 'agent-1'));
    expect(result.current).toBe(false);

    act(() => setPrefersTemporarySandbox(null, 'agent-1', true));
    expect(result.current).toBe(true);
  });

  it('re-renders a reader when another tab writes', () => {
    const { result } = renderHook(() => usePrefersTemporarySandbox(null, 'agent-1'));
    expect(result.current).toBe(false);

    act(() => {
      // What the browser does for a write made in another tab.
      localStorage.setItem(
        TEMPORARY_SANDBOX_PREFERENCE_KEY,
        JSON.stringify({ 'personal:agent-1': true }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: TEMPORARY_SANDBOX_PREFERENCE_KEY }));
    });
    expect(result.current).toBe(true);
  });
});
