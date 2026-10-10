/**
 * @vitest-environment happy-dom
 *
 * One agent's channel (bot) providers and the account-wide channel platform
 * catalog are replicas: the first frame paints the persisted copy, the network
 * only confirms, a mutation revalidates the affected agent's providers, and a
 * scope switch drops the previous identity's rows before the next paints.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentBotProviderService } from '@/services/agentBotProvider';

import { useAgentStore } from '../../store';
import { initialBotSliceState } from './initialState';
import {
  type BotProviderItem,
  botProvidersResource,
  platformDefinitionsResource,
} from './projection';

vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: {
    connectBot: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    exportByAgentId: vi.fn(),
    feishuFetchOwnerId: vi.fn(),
    getByAgentId: vi.fn(),
    lineFetchBotInfo: vi.fn(),
    listPlatforms: vi.fn(),
    refreshRuntimeStatus: vi.fn(),
    refreshRuntimeStatusesByAgent: vi.fn(),
    testConnection: vi.fn(),
    update: vi.fn(),
  },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const provider = (id: string, platform = 'discord'): BotProviderItem => ({
  applicationId: `${id}-app`,
  credentials: {},
  enabled: true,
  id,
  platform,
});

const platformDef = (id: string) => ({ id }) as never;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const AGENT_ID = 'agent-1';
const PROVIDERS_STORAGE_KEY = botProvidersResource.storageKey({ agentId: AGENT_ID });
const CATALOG_STORAGE_KEY = platformDefinitionsResource.storageKey({});

describe('bot replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`bot-user-${randomUUID()}:personal`);
    act(() => useAgentStore.setState(initialBotSliceState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) => [
        botProvidersResource.storage!.remove({ queryKey: PROVIDERS_STORAGE_KEY, scope: value }),
        platformDefinitionsResource.storage!.remove({
          queryKey: CATALOG_STORAGE_KEY,
          scope: value,
        }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted providers before the network answers', async () => {
    await botProvidersResource.storage!.set(
      { queryKey: PROVIDERS_STORAGE_KEY, scope },
      { data: [provider('bot-1')], updatedAt: 1 },
    );
    vi.mocked(agentBotProviderService.getByAgentId).mockImplementation(pending);

    const sync = renderHook(() => useAgentStore((s) => s.useFetchBotProviders)(AGENT_ID), {
      wrapper,
    });

    await waitFor(() =>
      expect(useAgentStore.getState().botProvidersMap[AGENT_ID]?.[0]?.id).toBe('bot-1'),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('drops cleartext credentials from the persisted copy but keeps them in memory', async () => {
    // A platform may hand a credential back in the clear — iMessage's
    // `webhookSecret` is public *and* the bearer secret inbound webhooks are
    // checked against — so the persisted copy must not carry it.
    const imessage: BotProviderItem = {
      ...provider('bot-2', 'imessage'),
      credentials: { desktopDeviceId: 'dev-1', webhookSecret: 'shared-secret' },
    };
    vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([imessage]);

    renderHook(() => useAgentStore((s) => s.useFetchBotProviders)(AGENT_ID), { wrapper });

    // The in-memory view keeps the credentials, so an edit form can seed from it.
    await waitFor(() =>
      expect(useAgentStore.getState().botProvidersMap[AGENT_ID]?.[0]?.credentials).toEqual({
        desktopDeviceId: 'dev-1',
        webhookSecret: 'shared-secret',
      }),
    );
    // The persisted row drops them entirely — no bearer secret left on disk.
    await waitFor(async () =>
      expect(
        (await botProvidersResource.storage!.get({ queryKey: PROVIDERS_STORAGE_KEY, scope }))?.data,
      ).toEqual([provider('bot-2', 'imessage')]),
    );
  });

  it('keeps the masked placeholders — not a secret — in the persisted copy', async () => {
    const discord: BotProviderItem = {
      ...provider('bot-3', 'discord'),
      credentials: { botToken: '••••••••', publicKey: 'a'.repeat(64) },
    };
    vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([discord]);

    renderHook(() => useAgentStore((s) => s.useFetchBotProviders)(AGENT_ID), { wrapper });

    await waitFor(() =>
      expect(useAgentStore.getState().botProvidersMap[AGENT_ID]?.[0]?.credentials).toEqual({
        botToken: '••••••••',
        publicKey: 'a'.repeat(64),
      }),
    );
    // The mask survives (a hydrated edit form can still show the field is set and
    // round-trip it on save); the cleartext identifier does not.
    await waitFor(async () =>
      expect(
        (await botProvidersResource.storage!.get({ queryKey: PROVIDERS_STORAGE_KEY, scope }))?.data,
      ).toEqual([{ ...provider('bot-3', 'discord'), credentials: { botToken: '••••••••' } }]),
    );
  });

  it('pre-hydrates the catalog and this agent’s providers before any network', async () => {
    await botProvidersResource.storage!.set(
      { queryKey: PROVIDERS_STORAGE_KEY, scope },
      { data: [provider('bot-1')], updatedAt: 1 },
    );
    await platformDefinitionsResource.storage!.set(
      { queryKey: CATALOG_STORAGE_KEY, scope },
      { data: [platformDef('discord')], updatedAt: 1 },
    );
    vi.mocked(agentBotProviderService.getByAgentId).mockImplementation(pending);
    vi.mocked(agentBotProviderService.listPlatforms).mockImplementation(pending);

    await act(() => useAgentStore.getState().preHydrateBotChannels(AGENT_ID));

    expect(useAgentStore.getState().botProvidersMap[AGENT_ID]?.[0]?.id).toBe('bot-1');
    expect(useAgentStore.getState().botPlatformDefinitions?.[0]?.id).toBe('discord');
  });

  it('paints the persisted platform catalog before the network answers', async () => {
    await platformDefinitionsResource.storage!.set(
      { queryKey: CATALOG_STORAGE_KEY, scope },
      { data: [platformDef('discord')], updatedAt: 1 },
    );
    vi.mocked(agentBotProviderService.listPlatforms).mockImplementation(pending);

    const sync = renderHook(() => useAgentStore((s) => s.useFetchPlatformDefinitions)(), {
      wrapper,
    });

    await waitFor(() =>
      expect(useAgentStore.getState().botPlatformDefinitions?.[0]?.id).toBe('discord'),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the platform catalog with the server response', async () => {
    vi.mocked(agentBotProviderService.listPlatforms).mockResolvedValue([
      platformDef('slack'),
      platformDef('feishu'),
    ]);

    renderHook(() => useAgentStore((s) => s.useFetchPlatformDefinitions)(), { wrapper });

    await waitFor(() =>
      expect(useAgentStore.getState().botPlatformDefinitions?.map((item) => item.id)).toEqual([
        'slack',
        'feishu',
      ]),
    );
  });

  it('drops the previous identity’s providers before the next paints', async () => {
    vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([provider('bot-1')]);
    const sync = renderHook(() => useAgentStore((s) => s.useFetchBotProviders)(AGENT_ID), {
      wrapper,
    });
    await waitFor(() => expect(useAgentStore.getState().botProvidersMap[AGENT_ID]).toHaveLength(1));

    vi.mocked(agentBotProviderService.getByAgentId).mockImplementation(pending);
    useScope(`bot-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useAgentStore.getState().botProvidersMap[AGENT_ID]).toBeUndefined());
  });

  describe('mutations', () => {
    const seed = async () => {
      vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([
        provider('bot-1'),
        provider('bot-2'),
      ]);
      renderHook(() => useAgentStore((s) => s.useFetchBotProviders)(AGENT_ID), { wrapper });
      await waitFor(() =>
        expect(useAgentStore.getState().botProvidersMap[AGENT_ID]).toHaveLength(2),
      );
    };

    it('revalidates the agent’s providers after a delete', async () => {
      await seed();
      vi.mocked(agentBotProviderService.delete).mockResolvedValue({ success: true } as never);
      vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([provider('bot-2')]);

      await act(() => useAgentStore.getState().deleteBotProvider('bot-1', AGENT_ID));

      await waitFor(() =>
        expect(useAgentStore.getState().botProvidersMap[AGENT_ID].map((item) => item.id)).toEqual([
          'bot-2',
        ]),
      );
    });

    it('refreshes the active agent when no agent id is given', async () => {
      await seed();
      act(() => useAgentStore.setState({ activeAgentId: AGENT_ID }));
      vi.mocked(agentBotProviderService.getByAgentId).mockResolvedValue([provider('bot-3')]);

      await act(() => useAgentStore.getState().internal_refreshBotProviders());

      await waitFor(() =>
        expect(useAgentStore.getState().botProvidersMap[AGENT_ID]?.map((item) => item.id)).toEqual([
          'bot-3',
        ]),
      );
    });
  });
});
