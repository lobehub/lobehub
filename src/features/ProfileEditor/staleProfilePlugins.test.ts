/**
 * @vitest-environment happy-dom
 */
import type { AgentPluginEntry } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnsureMarketSkillResult } from '@/services/skill';
import { initialState, type ToolStoreState } from '@/store/tool/initialState';
import { AGENT_SKILL_LIST_KEY } from '@/store/tool/slices/agentSkills/projection';
import { UNINSTALLED_BUILTIN_TOOLS_KEY } from '@/store/tool/slices/builtin/projection';
import { CONNECTOR_LIST_KEY } from '@/store/tool/slices/connector/projection';
import { INSTALLED_PLUGINS_KEY } from '@/store/tool/slices/plugin/projection';

import {
  resolveStalePluginCleanup,
  resolveUnresolvedPluginIds,
  selectProfileToolCatalogsSynced,
  type StalePluginAutoResolveInput,
  type StalePluginCleanupInput,
  useStalePluginAutoResolve,
} from './staleProfilePlugins';

const ensureMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/ensureAgentMarketSkills', () => ({ ensureAgentMarketSkills: ensureMock }));

const notSkill = (...ids: string[]): EnsureMarketSkillResult[] =>
  ids.map((identifier) => ({ identifier, status: 'notSkill' }));

const baseInput = (overrides: Partial<StalePluginCleanupInput> = {}): StalePluginCleanupInput => ({
  canEditContent: true,
  canEditResource: true,
  isAccessResolved: true,
  isConnectorsInit: true,
  isToolCatalogSynced: true,
  plugins: ['web-search', 'ghost-tool'],
  validIdentifiers: new Set(['web-search']),
  ...overrides,
});

describe('resolveStalePluginCleanup', () => {
  it('drops entries whose identifier no longer resolves', () => {
    expect(resolveStalePluginCleanup(baseInput(), notSkill('ghost-tool'))).toEqual(['web-search']);
  });

  it('keeps the original entry shape for surviving entries', () => {
    const result = resolveStalePluginCleanup(
      baseInput({
        plugins: [{ identifier: 'web-search', mode: 'disabled' }, 'ghost-tool'],
      }),
      notSkill('ghost-tool'),
    );

    expect(result).toEqual([{ identifier: 'web-search', mode: 'disabled' }]);
  });

  it('returns null when nothing is stale, so no write is fired', () => {
    expect(
      resolveStalePluginCleanup(
        baseInput({ plugins: ['web-search'], validIdentifiers: new Set(['web-search']) }),
        notSkill('web-search'),
      ),
    ).toBeNull();
  });

  // The server could not say the entry is not a skill, so it may still be a
  // valid Market skill that failed to download: keep it for the next open.
  it.each<[string, EnsureMarketSkillResult[]]>([
    ['installed', [{ identifier: 'ghost-tool', status: 'installed' }]],
    ['skipped', [{ identifier: 'ghost-tool', status: 'skipped' }]],
    ['failed', [{ identifier: 'ghost-tool', reason: 'download', status: 'failed' }]],
    ['unavailable', [{ identifier: 'ghost-tool', reason: 'unavailable', status: 'failed' }]],
    ['not reported', []],
  ])('keeps an unresolved entry whose ensure result is %s', (_, results) => {
    expect(resolveStalePluginCleanup(baseInput(), results)).toBeNull();
  });

  it('removes nothing without ensure results', () => {
    expect(resolveStalePluginCleanup(baseInput())).toBeNull();
  });

  it('only removes not-a-skill entries and leaves the rest untouched in place', () => {
    const plugins = [
      'web-search',
      { identifier: 'ghost-a', mode: 'disabled' as const },
      'market-skill',
      { identifier: 'ghost-b' },
      { identifier: 'kept-disabled', mode: 'disabled' as const },
    ];

    expect(
      resolveStalePluginCleanup(
        baseInput({
          plugins,
          validIdentifiers: new Set(['web-search', 'kept-disabled']),
        }),
        [
          { identifier: 'ghost-a', status: 'notSkill' },
          { identifier: 'market-skill', status: 'installed' },
          { identifier: 'ghost-b', status: 'notSkill' },
        ],
      ),
    ).toEqual(['web-search', 'market-skill', { identifier: 'kept-disabled', mode: 'disabled' }]);
  });

  it('does not remove a now-resolved entry even if the server called it not-a-skill', () => {
    expect(
      resolveStalePluginCleanup(
        baseInput({ plugins: ['web-search'], validIdentifiers: new Set(['web-search']) }),
        notSkill('web-search'),
      ),
    ).toBeNull();
  });

  it('returns null before the connector store has loaded', () => {
    expect(
      resolveStalePluginCleanup(baseInput({ isConnectorsInit: false }), notSkill('ghost-tool')),
    ).toBeNull();
  });

  // https://github.com/lobehub/lobehub/issues/18856 — on a cold start the
  // installed-plugin list is still empty when the connectors load, so a bound
  // custom tool looked stale and the profile saved `plugins: []`.
  it('returns null while the tool catalogs are still loading', () => {
    expect(
      resolveStalePluginCleanup(
        baseInput({
          isToolCatalogSynced: false,
          plugins: ['web-search', 'my-custom-tool'],
          validIdentifiers: new Set(['web-search']),
        }),
        notSkill('my-custom-tool'),
      ),
    ).toBeNull();
  });

  it('returns null when no identifiers are known yet', () => {
    expect(
      resolveStalePluginCleanup(baseInput({ validIdentifiers: new Set() }), notSkill('ghost-tool')),
    ).toBeNull();
  });

  it('returns null for an agent with no plugins', () => {
    expect(resolveStalePluginCleanup(baseInput({ plugins: undefined }), [])).toBeNull();
    expect(resolveStalePluginCleanup(baseInput({ plugins: [] }), [])).toBeNull();
  });

  // automatic corrections must not trigger phantom save-error toasts: the cleanup is automatic, so firing it without edit access made
  // the server reject `agent.updateAgentConfig`; because the rejected write never
  // persists, it fired and failed again on every open, toasting "Failed to save
  // agent settings" on an agent the member had only opened.
  describe('permission gate (automatic corrections must not trigger phantom save-error toasts)', () => {
    it('does not clean up when the workspace role cannot edit content', () => {
      expect(
        resolveStalePluginCleanup(baseInput({ canEditContent: false }), notSkill('ghost-tool')),
      ).toBeNull();
    });

    it('does not clean up when General access on this agent is below edit', () => {
      expect(
        resolveStalePluginCleanup(baseInput({ canEditResource: false }), notSkill('ghost-tool')),
      ).toBeNull();
    });

    it('fails closed while workspace access is still resolving', () => {
      expect(
        resolveStalePluginCleanup(
          // `canEditResource` defaults permissive during loading, so the
          // resolved flag is what keeps the doomed write from being fired.
          baseInput({ canEditResource: true, isAccessResolved: false }),
          notSkill('ghost-tool'),
        ),
      ).toBeNull();
    });
  });
});

describe('resolveUnresolvedPluginIds', () => {
  it('lists each unresolved identifier once, whatever the entry shape or mode', () => {
    expect(
      resolveUnresolvedPluginIds(
        baseInput({
          plugins: [
            'web-search',
            'ghost-a',
            { identifier: 'ghost-a', mode: 'disabled' },
            { identifier: 'ghost-b' },
          ],
        }),
      ),
    ).toEqual(['ghost-a', 'ghost-b']);
  });

  it.each([
    ['canEditContent', { canEditContent: false }],
    ['canEditResource', { canEditResource: false }],
    ['isAccessResolved', { isAccessResolved: false }],
    ['isConnectorsInit', { isConnectorsInit: false }],
    ['isToolCatalogSynced', { isToolCatalogSynced: false }],
    ['validIdentifiers', { validIdentifiers: new Set<string>() }],
  ])('lists nothing while the %s gate is not satisfied', (_, overrides) => {
    expect(resolveUnresolvedPluginIds(baseInput(overrides))).toEqual([]);
  });

  it('lists nothing when every entry resolves', () => {
    expect(resolveUnresolvedPluginIds(baseInput({ plugins: ['web-search'] }))).toEqual([]);
  });
});

describe('useStalePluginAutoResolve', () => {
  const update = vi.fn();
  let live: AgentPluginEntry[] | undefined;
  let liveScope = 'user-1:personal';

  const deferred = () => {
    let resolve!: (value: EnsureMarketSkillResult[]) => void;
    const promise = new Promise<EnsureMarketSkillResult[]>((r) => (resolve = r));
    return { promise, resolve };
  };

  const hookInput = (
    overrides: Partial<StalePluginAutoResolveInput> = {},
  ): StalePluginAutoResolveInput => {
    const base = baseInput(overrides);
    live = base.plugins;
    liveScope = overrides.scope ?? 'user-1:personal';
    return {
      ...base,
      agentId: 'agent-1',
      getCurrentPlugins: () => live,
      getScope: () => liveScope,
      scope: 'user-1:personal',
      updatePlugins: update,
      ...overrides,
    };
  };

  const settle = (ms = 500) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    update.mockReset();
    ensureMock.mockReset();
    ensureMock.mockImplementation(async () => notSkill('ghost-tool'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['canEditContent', { canEditContent: false }],
    ['canEditResource', { canEditResource: false }],
    ['isAccessResolved', { isAccessResolved: false }],
    ['isConnectorsInit', { isConnectorsInit: false }],
    ['isToolCatalogSynced', { isToolCatalogSynced: false }],
  ])('sends no write request while the %s gate is not satisfied', async (_, overrides) => {
    renderHook(() => useStalePluginAutoResolve(hookInput(overrides)));
    await settle();

    expect(ensureMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('asks about the unresolved identifiers only, then drops the not-a-skill ones', async () => {
    renderHook(() => useStalePluginAutoResolve(hookInput()));
    await settle();

    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(ensureMock).toHaveBeenCalledWith(['ghost-tool']);
    expect(update).toHaveBeenCalledWith('agent-1', ['web-search']);
  });

  it.each<[string, () => Promise<EnsureMarketSkillResult[]>]>([
    ['installed', async () => [{ identifier: 'ghost-tool', status: 'installed' }]],
    ['failed', async () => [{ identifier: 'ghost-tool', reason: 'download', status: 'failed' }]],
    [
      'rejected',
      async () => {
        throw new Error('network down');
      },
    ],
  ])('keeps every entry when ensure is %s', async (_, outcome) => {
    ensureMock.mockImplementation(outcome);
    renderHook(() => useStalePluginAutoResolve(hookInput()));
    await settle();

    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not repeat the request while one is in flight or after it settled', async () => {
    const pending = deferred();
    ensureMock.mockImplementation(() => pending.promise);
    const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
      initialProps: hookInput(),
    });
    await settle();

    rerender(hookInput({ validIdentifiers: new Set(['web-search']) }));
    await settle();
    expect(ensureMock).toHaveBeenCalledTimes(1);

    pending.resolve(notSkill('ghost-tool'));
    await settle();
    rerender(hookInput({ validIdentifiers: new Set(['web-search']) }));
    await settle();

    expect(ensureMock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('tracks attempts per scope and agent', async () => {
    const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
      initialProps: hookInput(),
    });
    await settle();
    rerender(hookInput({ agentId: 'agent-2' }));
    await settle();
    rerender(hookInput({ agentId: 'agent-2', scope: 'user-1:workspace-1' }));
    await settle();

    expect(ensureMock).toHaveBeenCalledTimes(3);
    expect(update.mock.calls.map(([agentId]) => agentId)).toEqual([
      'agent-1',
      'agent-2',
      'agent-2',
    ]);
  });

  it('abandons the write when the plugins changed meanwhile, then retries on the new snapshot', async () => {
    const pending = deferred();
    ensureMock.mockImplementationOnce(() => pending.promise);
    const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
      initialProps: hookInput(),
    });
    await settle();

    // the user edits the tool list while the request is in flight
    const edited = ['web-search', 'ghost-tool', 'added-by-user'];
    live = edited;
    rerender(
      hookInput({ plugins: edited, validIdentifiers: new Set(['web-search', 'added-by-user']) }),
    );
    live = edited;
    pending.resolve(notSkill('ghost-tool'));
    await settle();

    // nothing is written from the old snapshot; the new one is resolved on its own
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('agent-1', ['web-search', 'added-by-user']);
    expect(ensureMock).toHaveBeenCalledTimes(2);
  });

  it('abandons the write when the scope switched meanwhile', async () => {
    const pending = deferred();
    ensureMock.mockImplementationOnce(() => pending.promise);
    // the new scope gets its own attempt, which has nothing to remove
    ensureMock.mockImplementation(async () => []);
    const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
      initialProps: hookInput(),
    });
    await settle();

    rerender(hookInput({ plugins: live, scope: 'user-1:workspace-1' }));
    pending.resolve(notSkill('ghost-tool'));
    await settle();

    expect(update).not.toHaveBeenCalled();
  });

  // Same workspace (here: personal mode), another signed-in user: the cache
  // scope carries the user id, so the old response must not land.
  it.each([
    ['rendered', true],
    ['not rendered yet', false],
  ])(
    'abandons the write when another user signed in on the same workspace (%s)',
    async (_, rendered) => {
      const pending = deferred();
      ensureMock.mockImplementationOnce(() => pending.promise);
      // the new scope gets its own attempt, which has nothing to remove
      ensureMock.mockImplementation(async () => []);
      const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
        initialProps: hookInput(),
      });
      await settle();

      const plugins = live;
      if (rendered) rerender(hookInput({ plugins, scope: 'user-2:personal' }));
      else liveScope = 'user-2:personal';
      pending.resolve(notSkill('ghost-tool'));
      await settle();

      expect(update).not.toHaveBeenCalled();
    },
  );

  it('abandons the write when edit permission is lost meanwhile', async () => {
    const pending = deferred();
    ensureMock.mockImplementationOnce(() => pending.promise);
    const { rerender } = renderHook((input) => useStalePluginAutoResolve(input), {
      initialProps: hookInput(),
    });
    await settle();

    rerender(hookInput({ canEditResource: false, plugins: live }));
    pending.resolve(notSkill('ghost-tool'));
    await settle();

    expect(update).not.toHaveBeenCalled();
  });

  it('abandons the write when the profile is closed meanwhile', async () => {
    const pending = deferred();
    ensureMock.mockImplementationOnce(() => pending.promise);
    const { unmount } = renderHook(() => useStalePluginAutoResolve(hookInput()));
    await settle();

    unmount();
    pending.resolve(notSkill('ghost-tool'));
    await settle();

    expect(update).not.toHaveBeenCalled();
  });
});

describe('selectProfileToolCatalogsSynced', () => {
  type Source = 'local' | 'server' | 'storage';

  const entry = (source: Source) => ({ data: [], source }) as any;

  const stateWith = (sources: {
    agentSkills?: Source;
    connectors?: Source;
    installedPlugins?: Source;
    uninstalledBuiltinTools?: Source;
  }): ToolStoreState =>
    ({
      ...initialState,
      agentSkillListReplica: {
        ...initialState.agentSkillListReplica,
        entries: sources.agentSkills ? { [AGENT_SKILL_LIST_KEY]: entry(sources.agentSkills) } : {},
      },
      connectorsReplica: {
        ...initialState.connectorsReplica,
        entries: sources.connectors ? { [CONNECTOR_LIST_KEY]: entry(sources.connectors) } : {},
      },
      installedPluginsReplica: {
        ...initialState.installedPluginsReplica,
        entries: sources.installedPlugins
          ? { [INSTALLED_PLUGINS_KEY]: entry(sources.installedPlugins) }
          : {},
      },
      uninstalledBuiltinToolsReplica: {
        ...initialState.uninstalledBuiltinToolsReplica,
        entries: sources.uninstalledBuiltinTools
          ? { [UNINSTALLED_BUILTIN_TOOLS_KEY]: entry(sources.uninstalledBuiltinTools) }
          : {},
      },
    }) as ToolStoreState;

  it('is true once every catalog holds the server response', () => {
    expect(
      selectProfileToolCatalogsSynced(
        stateWith({
          agentSkills: 'server',
          connectors: 'server',
          installedPlugins: 'server',
          uninstalledBuiltinTools: 'server',
        }),
      ),
    ).toBe(true);
  });

  // `isConnectorsInit` is already true after the IndexedDB hydrate, so a
  // connector bound on another device would look stale until the server list lands.
  it('is false while the connector list only holds its persisted IndexedDB copy', () => {
    expect(
      selectProfileToolCatalogsSynced(
        stateWith({
          agentSkills: 'server',
          connectors: 'storage',
          installedPlugins: 'server',
          uninstalledBuiltinTools: 'server',
        }),
      ),
    ).toBe(false);
  });

  it('is false on a cold start before the installed plugins load', () => {
    expect(
      selectProfileToolCatalogsSynced(
        stateWith({ agentSkills: 'server', uninstalledBuiltinTools: 'server' }),
      ),
    ).toBe(false);
  });

  it('is false while a catalog only holds its persisted IndexedDB copy', () => {
    expect(
      selectProfileToolCatalogsSynced(
        stateWith({
          agentSkills: 'server',
          installedPlugins: 'storage',
          uninstalledBuiltinTools: 'server',
        }),
      ),
    ).toBe(false);
  });

  it('is false before the agent skills or builtin tool state loads', () => {
    expect(selectProfileToolCatalogsSynced(stateWith({ installedPlugins: 'server' }))).toBe(false);
  });
});
