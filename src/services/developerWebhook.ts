import {
  type CreateDeveloperWebhookParams,
  type UpdateDeveloperWebhookParams,
  type WebhookDeliveryItem,
  type WebhookEndpointItem,
  type WebhookEndpointWithSecretItem,
} from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

/** Most endpoints a person can register in one space (the server caps it at 20). */
const LIST_LIMIT = 100;
/** The deliveries drawer shows the latest attempts only. */
const DELIVERY_LIMIT = 50;

/**
 * Developer webhooks of the active space: outbound events LobeHub pushes to URLs
 * the person registers. Personal or workspace scope comes from the active
 * workspace the TRPC client already sends.
 */
class DeveloperWebhookService {
  list = async () =>
    (await lambdaClient.developerWebhook.list.query({ limit: LIST_LIMIT, offset: 0 }))
      .items as WebhookEndpointItem[];

  /** Returns the endpoint with its plaintext secret: the only time it is readable. */
  create = async (params: CreateDeveloperWebhookParams) =>
    (await lambdaClient.developerWebhook.create.mutate(params)) as WebhookEndpointWithSecretItem;

  update = async (id: string, value: UpdateDeveloperWebhookParams) =>
    (await lambdaClient.developerWebhook.update.mutate({ id, value })) as WebhookEndpointItem;

  delete = (id: string) => lambdaClient.developerWebhook.delete.mutate({ id });

  rotateSecret = async (id: string) =>
    (await lambdaClient.developerWebhook.rotateSecret.mutate({
      id,
    })) as WebhookEndpointWithSecretItem;

  /** Sends one `webhook.test` event now and resolves with the attempt's result. */
  test = async (id: string) =>
    (await lambdaClient.developerWebhook.test.mutate({ id })) as WebhookDeliveryItem;

  listDeliveries = async (id: string) =>
    (
      await lambdaClient.developerWebhook.listDeliveries.query({
        id,
        limit: DELIVERY_LIMIT,
        offset: 0,
      })
    ).items as WebhookDeliveryItem[];

  redeliver = async (id: string, deliveryId: string) =>
    (await lambdaClient.developerWebhook.redeliver.mutate({
      deliveryId,
      id,
    })) as WebhookDeliveryItem;
}

export const developerWebhookService = new DeveloperWebhookService();
