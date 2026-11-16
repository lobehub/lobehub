import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getPendingSandboxSelection,
  seedPendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';

const AGENT = 'agent-follow';

const renderFollow = (temporary: boolean, hasTopic = false) =>
  renderHook((props) => useFollowSandboxModePreference(AGENT, props), {
    initialProps: { hasTopic, temporary },
  });

afterEach(() => setPendingSandboxSelection(AGENT));

// T-14161: another tab switching the agent's sandbox reaches this one only
// through the storage event; a conversation not started here follows it.
describe('useFollowSandboxModePreference', () => {
  it('drops the seeded drive default when the agent turns temporary', () => {
    seedPendingSandboxSelection(AGENT, { workingDirectory: '.' });
    const { rerender } = renderFollow(false);

    rerender({ hasTopic: false, temporary: true });

    expect(getPendingSandboxSelection(AGENT)).toBeUndefined();
  });

  it('keeps a folder picked for this conversation', () => {
    setPendingSandboxSelection(AGENT, { workingDirectory: 'notes' });
    const { rerender } = renderFollow(false);

    rerender({ hasTopic: false, temporary: true });

    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: 'notes' });
  });

  it('drops a bare temporary sandbox when the agent turns persistent', () => {
    setPendingSandboxSelection(AGENT, {});
    const { rerender } = renderFollow(true);

    rerender({ hasTopic: false, temporary: false });

    expect(getPendingSandboxSelection(AGENT)).toBeUndefined();
  });

  it('keeps a repository picked for this conversation', () => {
    setPendingSandboxSelection(AGENT, { environmentId: 'env-1' });
    const { rerender } = renderFollow(true);

    rerender({ hasTopic: false, temporary: false });

    expect(getPendingSandboxSelection(AGENT)).toEqual({ environmentId: 'env-1' });
  });

  it('changes nothing on mount, or for a conversation already started', () => {
    seedPendingSandboxSelection(AGENT, { workingDirectory: '.' });
    renderFollow(true);
    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: '.' });

    const { rerender } = renderFollow(false, true);
    rerender({ hasTopic: true, temporary: true });
    expect(getPendingSandboxSelection(AGENT)).toEqual({ workingDirectory: '.' });
  });
});
