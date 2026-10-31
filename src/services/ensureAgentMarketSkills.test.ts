import { getConnectorCatalog } from '@lobechat/const';
import { toast } from '@lobehub/ui';
import type * as I18nextModule from 'i18next';
import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { agentSkillService, type EnsureMarketSkillResult } from '@/services/skill';
import { initialState } from '@/store/tool/initialState';
import { builtinToolSelectors } from '@/store/tool/selectors';
import {
  AGENT_SKILL_LIST_KEY,
  agentSkillListResource,
} from '@/store/tool/slices/agentSkills/projection';
import { useToolStore } from '@/store/tool/store';

import {
  ensureAgentMarketSkills,
  ensureAgentMarketSkillsAndWarn,
  MARKET_SKILL_ENSURE_BATCH_SIZE,
} from './ensureAgentMarketSkills';

vi.mock('i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof I18nextModule>()),
  t: (key: string, options?: { skills?: string }) => `${key}: ${options?.skills}`,
}));

const installedAll = (ids: string[]): EnsureMarketSkillResult[] =>
  ids.map((identifier) => ({ identifier, status: 'installed' }));

const builtinToolId = builtinToolSelectors.installedAllMetaList(initialState)[0].identifier;
const connectorItem = getConnectorCatalog({ composio: true, lobehub: true })[0];
const connectorId =
  connectorItem.type === 'lobehub'
    ? connectorItem.provider.id
    : connectorItem.serverType.identifier;

describe('ensureAgentMarketSkills', () => {
  const refreshAgentSkills = vi.fn();
  let ensureFromMarket: MockInstance<typeof agentSkillService.ensureFromMarket>;

  /** `listSource` is where the skills list came from: the server, or the persisted copy. */
  const mockCatalog = (
    skills: { identifier: string; source: 'market' | 'user' }[] = [],
    listSource: 'server' | 'storage' = 'server',
  ) => {
    vi.spyOn(useToolStore, 'getState').mockReturnValue({
      ...initialState,
      agentSkillListMap: { [AGENT_SKILL_LIST_KEY]: skills },
      agentSkillListReplica: {
        ...initialState.agentSkillListReplica,
        entries: {
          [AGENT_SKILL_LIST_KEY]: { pending: [], source: listSource, updatedAt: 1 },
        },
      },
      refreshAgentSkills,
    } as unknown as ReturnType<typeof useToolStore.getState>);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    refreshAgentSkills.mockReset();
    refreshAgentSkills.mockResolvedValue(undefined);
    ensureFromMarket = vi
      .spyOn(agentSkillService, 'ensureFromMarket')
      .mockImplementation(async (ids) => installedAll(ids));
    mockCatalog();
  });

  it('sends no request for empty input', async () => {
    expect(await ensureAgentMarketSkills(undefined)).toEqual([]);
    expect(await ensureAgentMarketSkills([])).toEqual([]);
    expect(await ensureAgentMarketSkills([[], undefined as any])).toEqual([]);
    expect(ensureFromMarket).not.toHaveBeenCalled();
    expect(refreshAgentSkills).not.toHaveBeenCalled();
  });

  it('reads identifiers from string and object entries, including disabled ones', async () => {
    await ensureAgentMarketSkills([
      'skill-a',
      { identifier: 'skill-b', mode: 'disabled' },
      { identifier: 'skill-c' },
    ]);

    expect(ensureFromMarket).toHaveBeenCalledWith(['skill-a', 'skill-b', 'skill-c']);
  });

  it('merges and dedupes plugins across several agents into one request', async () => {
    await ensureAgentMarketSkills([
      ['skill-a', 'skill-b'],
      [{ identifier: 'skill-a' }, 'skill-c'],
    ]);

    expect(ensureFromMarket).toHaveBeenCalledTimes(1);
    expect(ensureFromMarket).toHaveBeenCalledWith(['skill-a', 'skill-b', 'skill-c']);
  });

  it('leaves out what the local catalog already resolves', async () => {
    mockCatalog([
      { identifier: 'installed-market', source: 'market' },
      { identifier: 'my-own-skill', source: 'user' },
    ]);

    await ensureAgentMarketSkills([
      builtinToolId,
      connectorId,
      'installed-market',
      'my-own-skill',
      'fresh-skill',
    ]);

    // a same-named skill from another source still goes to the server, which
    // reports the conflict instead of silently overwriting it
    expect(ensureFromMarket).toHaveBeenCalledWith(['my-own-skill', 'fresh-skill']);
  });

  it('still asks the server about installed Market skills while the list is only the persisted copy', async () => {
    // A hydrated list can predate a skill installed elsewhere; the server is
    // idempotent and answers `installed` for the ones already there.
    mockCatalog([{ identifier: 'installed-market', source: 'market' }], 'storage');

    await ensureAgentMarketSkills(['installed-market', 'fresh-skill']);

    expect(ensureFromMarket).toHaveBeenCalledWith(['installed-market', 'fresh-skill']);
  });

  it('sends nothing when every identifier is already resolved locally', async () => {
    expect(await ensureAgentMarketSkills([builtinToolId, connectorId])).toEqual([]);
    expect(ensureFromMarket).not.toHaveBeenCalled();
  });

  it('splits more than 50 identifiers into ordered batches', async () => {
    const ids = Array.from({ length: MARKET_SKILL_ENSURE_BATCH_SIZE * 2 + 20 }, (_, i) => `s-${i}`);

    const results = await ensureAgentMarketSkills(ids);

    expect(ensureFromMarket.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 20]);
    expect(results.map((r) => r.identifier)).toEqual(ids);
  });

  it('stops sending batches once the scope changed, and does not refresh the new scope', async () => {
    let scope = 'user-1:personal';
    vi.spyOn(agentSkillListResource.scope, 'get').mockImplementation(() => scope);
    ensureFromMarket.mockImplementationOnce(async (ids) => {
      // the user switches workspace while the first batch is in flight
      scope = 'user-1:workspace-2';
      return installedAll(ids);
    });
    const ids = Array.from({ length: 120 }, (_, i) => `s-${i}`);

    const results = await ensureAgentMarketSkills(ids);

    expect(ensureFromMarket).toHaveBeenCalledTimes(1);
    expect(results.slice(0, 50).every((r) => r.status === 'installed')).toBe(true);
    expect(results.slice(50)).toHaveLength(70);
    expect(
      results.slice(50).every((r) => r.status === 'failed' && r.reason === 'unavailable'),
    ).toBe(true);
    expect(refreshAgentSkills).not.toHaveBeenCalled();
  });

  it('refreshes the list when the scope never changed', async () => {
    vi.spyOn(agentSkillListResource.scope, 'get').mockReturnValue('user-1:personal');

    await ensureAgentMarketSkills(['skill-a']);

    expect(refreshAgentSkills).toHaveBeenCalledTimes(1);
  });

  it('turns a rejected request into unavailable results without throwing', async () => {
    ensureFromMarket.mockRejectedValueOnce(new Error('network down'));

    const results = await ensureAgentMarketSkills(['skill-a', 'skill-b']);

    expect(results).toEqual([
      { identifier: 'skill-a', message: 'network down', reason: 'unavailable', status: 'failed' },
      { identifier: 'skill-b', message: 'network down', reason: 'unavailable', status: 'failed' },
    ]);
    expect(refreshAgentSkills).not.toHaveBeenCalled();
  });

  it('keeps later batches running when an earlier batch fails', async () => {
    ensureFromMarket.mockRejectedValueOnce(new Error('boom'));
    const ids = Array.from({ length: 51 }, (_, i) => `s-${i}`);

    const results = await ensureAgentMarketSkills(ids);

    expect(results.filter((r) => r.status === 'failed')).toHaveLength(50);
    expect(results[50]).toEqual({ identifier: 's-50', status: 'installed' });
  });

  it('reports identifiers the server left out of its answer as unavailable', async () => {
    ensureFromMarket.mockResolvedValueOnce(installedAll(['skill-a']));

    const results = await ensureAgentMarketSkills(['skill-a', 'skill-b']);

    expect(results[1]).toMatchObject({
      identifier: 'skill-b',
      reason: 'unavailable',
      status: 'failed',
    });
  });

  it('treats a malformed response as unavailable', async () => {
    ensureFromMarket.mockResolvedValueOnce(undefined as any);

    const results = await ensureAgentMarketSkills(['skill-a']);

    expect(results).toMatchObject([{ identifier: 'skill-a', reason: 'unavailable' }]);
  });

  it('refreshes the skill list once after installs, whatever the batch count', async () => {
    await ensureAgentMarketSkills(Array.from({ length: 70 }, (_, i) => `s-${i}`));

    expect(refreshAgentSkills).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when nothing got installed', async () => {
    ensureFromMarket.mockResolvedValueOnce([{ identifier: 'skill-a', status: 'notSkill' }]);

    await ensureAgentMarketSkills(['skill-a']);

    expect(refreshAgentSkills).not.toHaveBeenCalled();
  });

  it('keeps the install results when refreshing the list fails', async () => {
    refreshAgentSkills.mockRejectedValue(new Error('list failed'));

    expect(await ensureAgentMarketSkills(['skill-a'])).toEqual([
      { identifier: 'skill-a', status: 'installed' },
    ]);
  });

  it('never throws, even when reading the local catalog fails', async () => {
    vi.spyOn(useToolStore, 'getState').mockImplementation(() => {
      throw new Error('store broken');
    });

    expect(await ensureAgentMarketSkills(['skill-a'])).toEqual([
      expect.objectContaining({ identifier: 'skill-a', reason: 'unavailable', status: 'failed' }),
    ]);
  });
});

describe('ensureAgentMarketSkillsAndWarn', () => {
  let warning: MockInstance<typeof toast.warning>;

  beforeEach(() => {
    vi.restoreAllMocks();
    warning = vi.spyOn(toast, 'warning').mockImplementation(() => '' as any);
    vi.spyOn(useToolStore, 'getState').mockReturnValue({
      ...initialState,
      refreshAgentSkills: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useToolStore.getState>);
  });

  it('shows one merged warning listing only the failed identifiers', async () => {
    vi.spyOn(agentSkillService, 'ensureFromMarket').mockResolvedValue([
      { identifier: 'ok', status: 'installed' },
      { identifier: 'tool-id', status: 'notSkill' },
      { identifier: 'bad-1', reason: 'download', status: 'failed' },
      { identifier: 'bad-2', reason: 'conflict', status: 'failed' },
    ]);

    await ensureAgentMarketSkillsAndWarn(['ok', 'tool-id', 'bad-1', 'bad-2']);

    expect(warning).toHaveBeenCalledTimes(1);
    const message = String(warning.mock.calls[0][0]);
    expect(message).toContain('bad-1');
    expect(message).toContain('bad-2');
    expect(message).not.toContain('tool-id');
  });

  it('stays quiet when nothing failed', async () => {
    vi.spyOn(agentSkillService, 'ensureFromMarket').mockResolvedValue([
      { identifier: 'a', status: 'installed' },
      { identifier: 'b', status: 'notSkill' },
    ]);

    await ensureAgentMarketSkillsAndWarn(['a', 'b']);

    expect(warning).not.toHaveBeenCalled();
  });
});
