import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyPermissionModeReport,
  effectivePermissionMode,
  getLocalPermissionModeSwitcher,
  pendingHeteroPermissionModeMetadata,
  readTopicPermissionMode,
  registerLocalPermissionModeSwitcher,
  resolveRunPermissionMode,
  setPendingHeteroPermissionMode,
} from './heteroPermissionMode';

const lab = vi.hoisted(() => ({ on: true }));

vi.mock('@/store/user', () => ({ getUserStoreState: () => ({}) }));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableBetterCodingExperience: () => lab.on },
}));

const storeWith = (metadata: Record<string, unknown> | undefined) => {
  const updateTopicMetadata = vi.fn(async () => {});
  const internal_dispatchTopic = vi.fn();
  const state = {
    internal_dispatchTopic,
    topicDataMap: metadata ? { k: { items: [{ id: 't', metadata }] } } : {},
    updateTopicMetadata,
  };
  return { get: () => state as any, internal_dispatchTopic, updateTopicMetadata };
};

describe('heteroPermissionMode (renderer)', () => {
  beforeEach(() => {
    lab.on = true;
  });

  it('starts local Claude Code runs in the topic mode only with the lab on', () => {
    expect(resolveRunPermissionMode('claude-code', { heteroPermissionMode: 'plan' })).toBe('plan');
    expect(resolveRunPermissionMode('claude-code', {})).toBe('bypassPermissions');
    expect(resolveRunPermissionMode('codex', { heteroPermissionMode: 'plan' })).toBeUndefined();
    lab.on = false;
    expect(
      resolveRunPermissionMode('claude-code', { heteroPermissionMode: 'plan' }),
    ).toBeUndefined();
  });

  it('hands the new-topic chip mode to the topic it creates', () => {
    setPendingHeteroPermissionMode('agent-1', 'acceptEdits');
    expect(pendingHeteroPermissionModeMetadata('agent-1', 'claude-code')).toEqual({
      heteroPermissionMode: 'acceptEdits',
    });
    expect(pendingHeteroPermissionModeMetadata('agent-1', 'codex')).toEqual({});
    expect(pendingHeteroPermissionModeMetadata('agent-2', 'claude-code')).toEqual({});
  });

  it('shows the mode a fallback actually ran in', () => {
    expect(readTopicPermissionMode({ heteroPermissionMode: 'auto' })).toBe('auto');
    expect(effectivePermissionMode('bypassPermissions', 'root')).toBe('acceptEdits');
    expect(effectivePermissionMode('plan', 'outdatedCli')).toBe('bypassPermissions');
    expect(effectivePermissionMode('plan', null)).toBe('plan');
  });

  it('persists a local report, and only follows a server-written one', async () => {
    const local = storeWith({ heteroPermissionMode: 'plan' });
    await applyPermissionModeReport(
      local.get,
      't',
      { fallback: null, permissionMode: 'acceptEdits' },
      { persist: true },
    );
    expect(local.updateTopicMetadata).toHaveBeenCalledWith('t', {
      heteroPermissionMode: 'acceptEdits',
      heteroPermissionModeFallback: null,
    });

    const remote = storeWith({ heteroPermissionMode: 'plan' });
    await applyPermissionModeReport(
      remote.get,
      't',
      { fallback: null, permissionMode: 'default' },
      { persist: false },
    );
    expect(remote.updateTopicMetadata).not.toHaveBeenCalled();
    expect(remote.internal_dispatchTopic).toHaveBeenCalledWith({
      id: 't',
      type: 'updateTopic',
      value: {
        metadata: { heteroPermissionMode: 'default', heteroPermissionModeFallback: null },
      },
    });
  });

  it('keeps the pick on a fallback and skips a report that changes nothing', async () => {
    const root = storeWith({ heteroPermissionMode: 'bypassPermissions' });
    await applyPermissionModeReport(
      root.get,
      't',
      { fallback: 'root', permissionMode: 'acceptEdits' },
      { persist: true },
    );
    expect(root.updateTopicMetadata).toHaveBeenCalledWith('t', {
      heteroPermissionModeFallback: 'root',
    });

    const same = storeWith({ heteroPermissionMode: 'plan', heteroPermissionModeFallback: null });
    await applyPermissionModeReport(
      same.get,
      't',
      { fallback: null, permissionMode: 'plan' },
      { persist: true },
    );
    expect(same.updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('routes a mid-run switch to the topic latest local run', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerLocalPermissionModeSwitcher('t', first);
    registerLocalPermissionModeSwitcher('t', second);
    unregisterFirst();
    expect(getLocalPermissionModeSwitcher('t')).toBe(second);
  });
});
