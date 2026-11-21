import {
  type CreateDeveloperWebhookParams,
  type UpdateDeveloperWebhookParams,
  type WebhookDeliveryItem,
  type WebhookEndpointItem,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import {
  arrayEntity,
  createReplicaSlice,
  recordLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { developerWebhookService } from '@/services/developerWebhook';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { webhookDeliveryListResource, webhookEndpointListResource } from './projection';
import { type DeveloperWebhookStore } from './store';

const n = setNamespace('developerWebhook');

const LIST_PARAMS = {} as Record<string, never>;
const LIST_KEY = 'all';

type Setter = StoreSetter<DeveloperWebhookStore>;

export const createDeveloperWebhookAction = (
  set: Setter,
  get: () => DeveloperWebhookStore,
  _api?: unknown,
) => new DeveloperWebhookActionImpl(set, get, _api);

const mapEndpoint =
  (id: string, fn: (endpoint: WebhookEndpointItem) => WebhookEndpointItem) =>
  (list: WebhookEndpointItem[]) =>
    list.map((endpoint) => (endpoint.id === id ? fn(endpoint) : endpoint));

export class DeveloperWebhookActionImpl {
  readonly #endpoints;
  readonly #deliveries;

  constructor(set: Setter, get: () => DeveloperWebhookStore, _api?: unknown) {
    void _api;
    this.#endpoints = createReplicaSlice(webhookEndpointListResource, {
      actionPrefix: n('endpointList'),
      entity: arrayEntity<WebhookEndpointItem>((endpoint) => endpoint.id),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'endpointListReplica',
      view: recordLens<DeveloperWebhookStore, WebhookEndpointItem[]>('endpointListMap'),
    });
    this.#deliveries = createReplicaSlice(webhookDeliveryListResource, {
      actionPrefix: n('deliveryList'),
      entity: arrayEntity<WebhookDeliveryItem>((delivery) => delivery.id),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'deliveryListReplica',
      view: recordLens<DeveloperWebhookStore, WebhookDeliveryItem[]>('deliveryListMap'),
    });
  }

  /** Returns the endpoint with the only plaintext copy of its signing secret. */
  createWebhook = async (params: CreateDeveloperWebhookParams) => {
    const created = await developerWebhookService.create(params);
    void this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
    return created;
  };

  /** Optimistic: the row drops at once and comes back if the call fails. */
  deleteWebhook = async (id: string) => {
    await this.#endpoints.optimistic(
      LIST_KEY,
      (list) => list.filter((endpoint) => endpoint.id !== id),
      () => developerWebhookService.delete(id),
    );
  };

  /** Queues the same event again; the drawer then shows the new pending delivery. */
  redeliver = async (endpointId: string, deliveryId: string) => {
    const delivery = await developerWebhookService.redeliver(endpointId, deliveryId);
    await this.#deliveries.fetch(endpointId, { fresh: true });
    return delivery;
  };

  refreshDeliveries = async (endpointId: string) => {
    await this.#deliveries.fetch(endpointId, { fresh: true });
  };

  refreshWebhookList = async () => {
    await this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
  };

  /** Returns the only plaintext copy of the new secret; the old one stops working. */
  rotateSecret = async (id: string) => {
    const rotated = await developerWebhookService.rotateSecret(id);
    void this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
    return rotated.secret;
  };

  /**
   * Optimistic toggle. Turning an auto-disabled endpoint back on also clears its
   * disabled reason on the server, so the list is confirmed afterwards.
   */
  setWebhookEnabled = async (id: string, enabled: boolean) => {
    await this.#endpoints.optimistic(
      LIST_KEY,
      mapEndpoint(id, (endpoint) => ({
        ...endpoint,
        disabledReason: enabled ? null : 'manual',
        enabled,
      })),
      () => developerWebhookService.update(id, { enabled }),
    );
    void this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
  };

  /** Sends a test event now and resolves with the attempt's result. */
  testWebhook = async (id: string) => {
    const delivery = await developerWebhookService.test(id);
    void this.#deliveries.fetch(id, { fresh: true });
    void this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
    return delivery;
  };

  updateWebhook = async (id: string, value: UpdateDeveloperWebhookParams) => {
    await this.#endpoints.optimistic(
      LIST_KEY,
      mapEndpoint(id, (endpoint) => ({ ...endpoint, ...value }) as WebhookEndpointItem),
      () => developerWebhookService.update(id, value),
    );
    void this.#endpoints.fetch(LIST_PARAMS, { fresh: true });
  };

  /** One endpoint's latest deliveries; read them with `developerWebhookSelectors.deliveryList`. */
  useFetchDeliveries = (endpointId: string | undefined): ReplicaSyncResult =>
    this.#deliveries.useSync(endpointId ?? null);

  /** The endpoint list; read it with `developerWebhookSelectors.endpointList`. */
  useFetchWebhookList = (enabled = true): ReplicaSyncResult =>
    this.#endpoints.useSync(enabled ? LIST_PARAMS : null);
}

export type DeveloperWebhookAction = Pick<
  DeveloperWebhookActionImpl,
  keyof DeveloperWebhookActionImpl
>;
