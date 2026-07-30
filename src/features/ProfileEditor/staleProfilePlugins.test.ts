import { describe, expect, it } from 'vitest';

import { resolveStalePluginCleanup, type StalePluginCleanupInput } from './staleProfilePlugins';

const baseInput = (overrides: Partial<StalePluginCleanupInput> = {}): StalePluginCleanupInput => ({
  canEditContent: true,
  canEditResource: true,
  isAccessResolved: true,
  isConnectorsInit: true,
  plugins: ['web-search', 'ghost-tool'],
  validIdentifiers: new Set(['web-search']),
  ...overrides,
});

describe('resolveStalePluginCleanup', () => {
  it('drops entries whose identifier no longer resolves', () => {
    expect(resolveStalePluginCleanup(baseInput())).toEqual(['web-search']);
  });

  it('keeps the original entry shape for surviving entries', () => {
    const result = resolveStalePluginCleanup(
      baseInput({
        plugins: [{ identifier: 'web-search', mode: 'disabled' }, 'ghost-tool'],
      }),
    );

    expect(result).toEqual([{ identifier: 'web-search', mode: 'disabled' }]);
  });

  it('returns null when nothing is stale, so no write is fired', () => {
    expect(
      resolveStalePluginCleanup(
        baseInput({ plugins: ['web-search'], validIdentifiers: new Set(['web-search']) }),
      ),
    ).toBeNull();
  });

  it('returns null before the connector store has loaded', () => {
    expect(resolveStalePluginCleanup(baseInput({ isConnectorsInit: false }))).toBeNull();
  });

  it('returns null when no identifiers are known yet', () => {
    expect(resolveStalePluginCleanup(baseInput({ validIdentifiers: new Set() }))).toBeNull();
  });

  it('returns null for an agent with no plugins', () => {
    expect(resolveStalePluginCleanup(baseInput({ plugins: undefined }))).toBeNull();
    expect(resolveStalePluginCleanup(baseInput({ plugins: [] }))).toBeNull();
  });

  // automatic corrections must not trigger phantom save-error toasts: the cleanup is automatic, so firing it without edit access made
  // the server reject `agent.updateAgentConfig`; because the rejected write never
  // persists, it fired and failed again on every open, toasting "Failed to save
  // agent settings" on an agent the member had only opened.
  describe('permission gate (automatic corrections must not trigger phantom save-error toasts)', () => {
    it('does not clean up when the workspace role cannot edit content', () => {
      expect(resolveStalePluginCleanup(baseInput({ canEditContent: false }))).toBeNull();
    });

    it('does not clean up when General access on this agent is below edit', () => {
      expect(resolveStalePluginCleanup(baseInput({ canEditResource: false }))).toBeNull();
    });

    it('fails closed while workspace access is still resolving', () => {
      expect(
        resolveStalePluginCleanup(
          // `canEditResource` defaults permissive during loading, so the
          // resolved flag is what keeps the doomed write from being fired.
          baseInput({ canEditResource: true, isAccessResolved: false }),
        ),
      ).toBeNull();
    });
  });
});
