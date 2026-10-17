import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { marketApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { useToolStore } from '@/store/tool';

import { installMarketplaceAgents } from './installMarketplaceAgents';

describe('installMarketplaceAgents', () => {
  const createAgent = vi.fn();
  const refreshAgentList = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    createAgent.mockReset();
    refreshAgentList.mockReset();
    refreshAgentList.mockResolvedValue(undefined);

    vi.spyOn(useAgentStore, 'getState').mockReturnValue({
      createAgent,
    } as unknown as ReturnType<typeof useAgentStore.getState>);
    vi.spyOn(useHomeStore, 'getState').mockReturnValue({
      refreshAgentList,
    } as unknown as ReturnType<typeof useHomeStore.getState>);
    vi.spyOn(discoverService, 'reportAgentEvent').mockResolvedValue(undefined);
  });

  it('sends a single batched fork call carrying every selected agent', async () => {
    const sourceIds = ['src-a', 'src-b', 'src-c'];

    vi.spyOn(agentService, 'getAgentByForkedFromIdentifier').mockResolvedValue(null);
    vi.spyOn(discoverService, 'getAssistantDetail').mockImplementation(
      async ({ identifier }) =>
        ({
          avatar: 'avatar',
          backgroundColor: '#fff',
          category: 'engineering',
          config: { params: {} } as any,
          description: `desc-${identifier}`,
          editorData: {},
          identifier,
          summary: `summary-${identifier}`,
          tags: [],
          title: `Title-${identifier}`,
        }) as any,
    );

    const forkSpy = vi.spyOn(marketApiService, 'forkAgent').mockImplementation(async (items) =>
      items.map((item) => ({
        data: {
          agent: {
            createdAt: '2026-01-01',
            forkedFromAgentId: 1,
            id: 1,
            identifier: item.identifier,
            name: item.name ?? '',
            ownerId: 1,
            updatedAt: '2026-01-01',
          },
          source: { agentId: 1, identifier: item.sourceIdentifier, versionNumber: 1 },
          version: { agentId: 1, createdAt: '2026-01-01', id: 1, versionNumber: 1 },
        },
        sourceIdentifier: item.sourceIdentifier,
        success: true as const,
      })),
    );

    createAgent.mockImplementation(async ({ config }: any) => ({
      agentId: `agent-${config.params.forkedFromIdentifier}`,
    }));

    const result = await installMarketplaceAgents(sourceIds);

    expect(forkSpy).toHaveBeenCalledTimes(1);
    const [items] = forkSpy.mock.calls[0];
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.sourceIdentifier)).toEqual(sourceIds);

    expect(createAgent).toHaveBeenCalledTimes(3);
    expect(result.installedAgentIds).toHaveLength(3);
    expect(result.skippedAgentIds).toEqual([]);
    expect(refreshAgentList).toHaveBeenCalledTimes(1);
  });

  it('skips already-forked agents at the dedupe step', async () => {
    const sourceIds = ['src-a', 'src-b', 'src-c'];

    vi.spyOn(agentService, 'getAgentByForkedFromIdentifier').mockImplementation(async (id) =>
      id === 'src-a' ? null : `existing-${id}`,
    );
    vi.spyOn(discoverService, 'getAssistantDetail').mockImplementation(
      async ({ identifier }) =>
        ({
          avatar: 'a',
          backgroundColor: '#fff',
          category: 'engineering',
          config: { params: {} } as any,
          description: 'd',
          editorData: {},
          identifier,
          summary: 's',
          tags: [],
          title: 'T',
        }) as any,
    );
    const forkSpy = vi.spyOn(marketApiService, 'forkAgent').mockImplementation(async (items) =>
      items.map((item) => ({
        data: {
          agent: {
            createdAt: '',
            forkedFromAgentId: 1,
            id: 1,
            identifier: item.identifier,
            name: item.name ?? '',
            ownerId: 1,
            updatedAt: '',
          },
          source: { agentId: 1, identifier: item.sourceIdentifier, versionNumber: 1 },
          version: { agentId: 1, createdAt: '', id: 1, versionNumber: 1 },
        },
        sourceIdentifier: item.sourceIdentifier,
        success: true as const,
      })),
    );
    createAgent.mockImplementation(async ({ config }: any) => ({
      agentId: `agent-${config.params.forkedFromIdentifier}`,
    }));

    const result = await installMarketplaceAgents(sourceIds);

    expect(forkSpy).toHaveBeenCalledTimes(1);
    const [items] = forkSpy.mock.calls[0];
    expect(items.map((i) => i.sourceIdentifier)).toEqual(['src-a']);
    expect(result.skippedAgentIds).toEqual(['src-b', 'src-c']);
    expect(result.installedAgentIds).toEqual(['agent-src-a']);
  });

  describe('market skills referenced by the installed agents', () => {
    const pluginsBySource: Record<string, any[]> = {
      'src-a': ['skill-a', { identifier: 'skill-shared', mode: 'disabled' }],
      'src-b': ['skill-b'],
      'src-c': ['skill-shared', 'skill-c'],
    };

    const arrange = (failCreateFor?: string) => {
      vi.spyOn(agentService, 'getAgentByForkedFromIdentifier').mockResolvedValue(null);
      vi.spyOn(discoverService, 'getAssistantDetail').mockImplementation(
        async ({ identifier }) =>
          ({
            config: { params: {}, plugins: pluginsBySource[identifier] } as any,
            identifier,
            title: identifier,
          }) as any,
      );
      vi.spyOn(marketApiService, 'forkAgent').mockImplementation(async (items) =>
        items.map((item) => ({
          data: { agent: { identifier: item.identifier, name: item.name ?? '' } } as any,
          sourceIdentifier: item.sourceIdentifier,
          success: true as const,
        })),
      );
      createAgent.mockImplementation(async ({ config }: any) => {
        if (config.params.forkedFromIdentifier === failCreateFor) throw new Error('create failed');
        return { agentId: `agent-${config.params.forkedFromIdentifier}` };
      });
      vi.spyOn(useToolStore, 'getState').mockReturnValue({
        ...useToolStore.getState(),
        refreshAgentSkills: vi.fn().mockResolvedValue(undefined),
      });
    };

    it('ensures once, after every createAgent settled, for the created agents only', async () => {
      arrange('src-b');
      const ensure = vi
        .spyOn(agentSkillService, 'ensureFromMarket')
        .mockImplementation(async (ids) =>
          ids.map((id) => ({ identifier: id, status: 'installed' })),
        );

      const result = await installMarketplaceAgents(['src-a', 'src-b', 'src-c']);

      expect(ensure).toHaveBeenCalledTimes(1);
      expect(ensure).toHaveBeenCalledWith(['skill-a', 'skill-shared', 'skill-c']);
      expect(Math.min(...ensure.mock.invocationCallOrder)).toBeGreaterThan(
        Math.max(...createAgent.mock.invocationCallOrder),
      );
      expect(result.installedAgentIds).toEqual(['agent-src-a', 'agent-src-c']);
    });

    it('does not ask for skills when no agent could be created', async () => {
      arrange('src-a');
      const ensure = vi.spyOn(agentSkillService, 'ensureFromMarket');

      await installMarketplaceAgents(['src-a']);

      expect(ensure).not.toHaveBeenCalled();
    });

    it('keeps the install result and summaries when ensuring skills fails', async () => {
      arrange();
      vi.spyOn(agentSkillService, 'ensureFromMarket').mockRejectedValue(new Error('network down'));
      const warning = vi.spyOn(toast, 'warning').mockImplementation(() => '' as any);

      const result = await installMarketplaceAgents(['src-a', 'src-b']);

      expect(result.installedAgentIds).toEqual(['agent-src-a', 'agent-src-b']);
      expect(result.summaries.map((s) => s.installedAgentId)).toEqual([
        'agent-src-a',
        'agent-src-b',
      ]);
      expect(refreshAgentList).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledTimes(1);
    });
  });
});
