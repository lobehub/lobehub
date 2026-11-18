import { randomUUID } from 'node:crypto';

import debug from 'debug';

import {
  postSignedWebhook,
  type SignedWebhookResult,
} from '@/server/services/developerWebhook/send';

import {
  BOT_WEBHOOK_HEADERS,
  type BotWebhookOutboundEvent,
  type BotWebhookOutboundEventType,
} from './protocol';

const log = debug('bot-platform:webhook:callback');

/** Attempts per event, the first included. Replies are interactive, so retries stay short. */
export const BOT_WEBHOOK_CALLBACK_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 2000];

export interface BotWebhookCallbackTarget {
  /** The bot's application id, echoed as `botId`. */
  botId: string;
  callbackUrl: string;
  signingSecret: string;
}

export class BotWebhookCallbackError extends Error {
  readonly result: SignedWebhookResult;

  constructor(result: SignedWebhookResult) {
    super(`Callback URL refused the event: ${result.error ?? 'unknown error'}`);
    this.name = 'BotWebhookCallbackError';
    this.result = result;
  }
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

export const newOutboundMessageId = () => newId('out');

/** A 4xx other than timeout / rate limit is the receiver's verdict; asking again won't change it. */
const isRetryable = (result: SignedWebhookResult) => {
  if (result.permanent) return false;
  const status = result.responseStatus;
  if (status === null) return true;
  return status >= 500 || status === 408 || status === 429;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign and POST one event to the bot's callback URL, retrying transient failures
 * (network errors, timeouts, 5xx, 408, 429). Every attempt carries the same event id,
 * so the receiver can deduplicate. Throws `BotWebhookCallbackError` when the event
 * could not be delivered, so the reply path reports the failure instead of losing it.
 */
export const sendBotWebhookEvent = async (
  target: BotWebhookCallbackTarget,
  type: BotWebhookOutboundEventType,
  data: BotWebhookOutboundEvent['data'],
  { attempts = BOT_WEBHOOK_CALLBACK_ATTEMPTS }: { attempts?: number } = {},
): Promise<{ event: BotWebhookOutboundEvent; result: SignedWebhookResult }> => {
  const event: BotWebhookOutboundEvent = {
    botId: target.botId,
    createdAt: new Date().toISOString(),
    data,
    id: newId('evt'),
    type,
  };
  const body = JSON.stringify(event);

  let result: SignedWebhookResult | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await postSignedWebhook({
      body,
      headers: {
        [BOT_WEBHOOK_HEADERS.deliveryId]: `${event.id}.${attempt}`,
        [BOT_WEBHOOK_HEADERS.eventId]: event.id,
        [BOT_WEBHOOK_HEADERS.eventType]: type,
      },
      secret: target.signingSecret,
      url: target.callbackUrl,
    });
    if (result.error === null) return { event, result };

    log('event %s attempt %d failed: %s', event.id, attempt, result.error);
    if (attempt === attempts || !isRetryable(result)) break;
    await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1)!);
  }

  throw new BotWebhookCallbackError(result!);
};
