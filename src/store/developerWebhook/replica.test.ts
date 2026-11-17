/**
 * @vitest-environment happy-dom
 *
 * The Webhooks settings page reads its endpoints and each endpoint's deliveries
 * through `local-replica`: reopening paints the persisted list, toggles and
 * deletes are optimistic with rollback, and a test refreshes the deliveries.
 */
import { randomUUID } from 'node:crypto';

import { type WebhookDeliveryItem, type WebhookEndpointItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import { setScopedMutate } from '@/libs/swr/mutate';
import { developerWebhookService } from '@/services/developerWebhook';

import { initialDeveloperWebhookState } from './initialState';
import { webhookEndpointListResource } from './projection';
import { developerWebhookSelectors } from './selectors';
import { useDeveloperWebhookStore } from './store';

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

const pending = () => new Promise<never>(() => {});

const endpoint = (overrides: Partial<WebhookEndpointItem> = {}): WebhookEndpointItem => ({
  consecutiveFailures: 0,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  description: 'CI',
  disabledReason: null,
  enabled: true,
  events: ['run.completed'],
  id: 'whe_1',
  lastDeliveryAt: null,
  secretHint: 'abcd',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  url: 'https://example.com/hook',
  ...overrides,
});

const delivery = (overrides: Partial<WebhookDeliveryItem> = {}): WebhookDeliveryItem => ({
  attempts: 1,
  createdAt: new Date('2026-11-02T00:00:00Z'),
  deliveredAt: new Date('2026-11-02T00:00:00Z'),
  durationMs: 42,
  endpointId: 'whe_1',
  error: null,
  eventId: 'evt_1',
  eventType: 'webhook.test',
  id: 'whd_1',
  nextAttemptAt: null,
  redeliveryOf: null,
  responseStatus: 200,
  status: 'succeeded',
  ...overrides,
});

const state = () => useDeveloperWebhookStore.getState();

describe('developerWebhook replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  beforeEach(() => {
    resetCacheScopeBroadcast();
    scope = `webhook-user-${randomUUID()}:ws-1`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    useDeveloperWebhookStore.setState({ ...initialDeveloperWebhookState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        webhookEndpointListResource.storage!.remove({ queryKey: 'all', scope: value }),
      ),
    );
    scopes.clear();
    resetCacheScopeBroadcast();
    vi.restoreAllMocks();
  });

  it('paints the persisted endpoint list before the network answers', async () => {
    await webhookEndpointListResource.storage!.set(
      { queryKey: 'all', scope },
      { data: [endpoint()], updatedAt: 1 },
    );
    vi.spyOn(developerWebhookService, 'list').mockImplementation(pending);

    renderHook(() => state().useFetchWebhookList(), { wrapper });

    await waitFor(() =>
      expect(developerWebhookSelectors.endpointList(state())).toEqual([endpoint()]),
    );
  });

  it('turns an endpoint off at once and rolls back when the call fails', async () => {
    vi.spyOn(developerWebhookService, 'list').mockResolvedValue([endpoint()]);
    renderHook(() => state().useFetchWebhookList(), { wrapper });
    await waitFor(() => expect(developerWebhookSelectors.endpointList(state())).toHaveLength(1));

    let reject!: (error: Error) => void;
    vi.spyOn(developerWebhookService, 'update').mockImplementation(
      () => new Promise((_, r) => (reject = r)),
    );

    let call!: Promise<void>;
    act(() => {
      call = state().setWebhookEnabled('whe_1', false);
    });
    expect(developerWebhookSelectors.endpointList(state())?.[0]).toMatchObject({
      disabledReason: 'manual',
      enabled: false,
    });

    await act(async () => {
      reject(new Error('boom'));
      await call.catch(() => {});
    });
    expect(developerWebhookSelectors.endpointList(state())?.[0].enabled).toBe(true);
  });

  it('drops a deleted endpoint and restores it when the delete fails', async () => {
    vi.spyOn(developerWebhookService, 'list').mockResolvedValue([endpoint()]);
    renderHook(() => state().useFetchWebhookList(), { wrapper });
    await waitFor(() => expect(developerWebhookSelectors.endpointList(state())).toHaveLength(1));

    vi.spyOn(developerWebhookService, 'delete').mockRejectedValue(new Error('boom'));
    await act(async () => {
      await state()
        .deleteWebhook('whe_1')
        .catch(() => {});
    });

    expect(developerWebhookSelectors.endpointList(state())).toHaveLength(1);
  });

  it('refreshes the deliveries after a test', async () => {
    vi.spyOn(developerWebhookService, 'list').mockResolvedValue([endpoint()]);
    const listDeliveries = vi
      .spyOn(developerWebhookService, 'listDeliveries')
      .mockResolvedValueOnce([])
      .mockResolvedValue([delivery()]);
    vi.spyOn(developerWebhookService, 'test').mockResolvedValue(delivery());

    renderHook(() => state().useFetchDeliveries('whe_1'), { wrapper });
    await waitFor(() =>
      expect(developerWebhookSelectors.deliveryList('whe_1')(state())).toEqual([]),
    );

    let result!: WebhookDeliveryItem;
    await act(async () => {
      result = await state().testWebhook('whe_1');
    });

    expect(result.responseStatus).toBe(200);
    await waitFor(() =>
      expect(developerWebhookSelectors.deliveryList('whe_1')(state())).toEqual([delivery()]),
    );
    expect(listDeliveries).toHaveBeenCalledWith('whe_1');
  });
});
