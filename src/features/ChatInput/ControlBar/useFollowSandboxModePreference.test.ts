import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getPendingSandboxSelection,
  seedPendingSandboxSelection,
  setPendingSandboxSelection,
} from '@/store/chat/pendingSandboxSelection';

import { useFollowSandboxModePreference } from './useFollowSandboxModePreference';

const AGENT = 'agent-follow';

const SCOPE = `user-1::${AGENT}`;

interface Props {
  agentId?: string;
  enabled?: boolean;
  hasTopic: boolean;
  scopeKey?: string;
  temporary: boolean;
}

const renderFollow = (temporary: boolean, hasTopic = false) =>
  renderHook(
    ({ agentId = AGENT, enabled = true, scopeKey = SCOPE, ...rest }: Props) =>
      useFollowSandboxModePreference(agentId, { enabled, scopeKey, ...rest }),
    { initialProps: { hasTopic, temporary } as Props },
  );

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

  // T-14791: the temporary default now carries the agent's environment too.
  it('drops the seeded temporary default when the agent turns persistent', () => {
    seedPendingSandboxSelection(AGENT, { environmentId: 'env-1' });
    const { rerender } = renderFollow(true);

    rerender({ hasTopic: false, temporary: false });

    expect(getPendingSandboxSelection(AGENT)).toBeUndefined();
  });

  it('keeps the drive switched off for this conversation', () => {
    setPendingSandboxSelection(AGENT, {});
    const { rerender } = renderFollow(true);

    rerender({ hasTopic: false, temporary: false });

    expect(getPendingSandboxSelection(AGENT)).toEqual({});
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

  // The same composer reused for another agent (or workspace, or user) reads a
  // different preference; that is not this agent's mode changing.
  it('moves the baseline instead of acting when whose preference it is changes', () => {
    setPendingSandboxSelection(AGENT, {});
    const { rerender } = renderFollow(true);

    rerender({ hasTopic: false, scopeKey: 'user-1::other-agent', temporary: false });
    rerender({ hasTopic: false, scopeKey: SCOPE, temporary: true });

    expect(getPendingSandboxSelection(AGENT)).toEqual({});
  });

  it('leaves a member who cannot pick the mode where they are', () => {
    setPendingSandboxSelection(AGENT, {});
    const { rerender } = renderFollow(true);

    rerender({ enabled: false, hasTopic: false, temporary: false });

    expect(getPendingSandboxSelection(AGENT)).toEqual({});
  });
});
