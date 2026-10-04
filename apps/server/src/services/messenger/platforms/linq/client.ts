import { LinqApiClient, markdownToPlainText } from '@lobechat/agent-address-linq';
import debug from 'debug';

import type { MessengerLinqConfig } from '@/config/messenger';
import {
  messengerContentText,
  type PlatformClient,
  type PlatformMessenger,
} from '@/server/services/bot/platforms';

import { LinqChatAdapter } from './adapter';
import { pickLinqPoolNumber } from './pool';
import { decodeLinqThreadId } from './threadId';

const log = debug('lobe-server:messenger:linq:client');

export const LINQ_APPLICATION_ID = 'messenger-linq';

export const createLinqApi = (config: MessengerLinqConfig, fromNumber?: string): LinqApiClient =>
  new LinqApiClient({ apiKey: config.apiKey, baseUrl: config.apiBaseUrl, fromNumber });

/**
 * Send to a person by handle rather than by chat id. Reuses the chat the
 * person already has with the pool (so the reply lands in the same Messages
 * thread they texted); otherwise opens one from the number this handle is
 * pinned to in the pool.
 */
export const sendLinqTextToHandle = async (
  config: MessengerLinqConfig,
  handle: string,
  text: string,
): Promise<void> => {
  const api = createLinqApi(config, pickLinqPoolNumber(config.numbers, handle));
  await api.sendToHandle({ handle, text: markdownToPlainText(text) });
};

/** E.164 phone or Apple ID email — anything else is a Linq chat id. */
const isHandle = (value: string): boolean => value.startsWith('+') || value.includes('@');

/**
 * `PlatformClient` for the shared Linq pool. Linq is a carrier: there is no
 * per-agent bot, no slash-command registry, and no editable bubbles — replies
 * are plain text posted into the person's chat.
 */
export class LinqMessengerClient implements PlatformClient {
  readonly id = 'linq';
  readonly applicationId = LINQ_APPLICATION_ID;

  constructor(private readonly config: MessengerLinqConfig) {}

  createAdapter(): Record<string, any> {
    return { linq: new LinqChatAdapter({ api: createLinqApi(this.config) }) };
  }

  getMessenger(platformThreadId: string): PlatformMessenger {
    const target = decodeLinqThreadId(platformThreadId);
    const api = createLinqApi(this.config);

    const send = async (text: string) => {
      const plain = markdownToPlainText(text).trim();
      if (!plain) return;
      if (isHandle(target)) {
        await sendLinqTextToHandle(this.config, target, plain);
        return;
      }
      await api.sendText(target, plain);
    };

    return {
      createMessage: async (content) => send(messengerContentText(content)),
      // Linq cannot edit a delivered bubble; the definition opts out of edits
      // so the bridge never relies on this, but a stray edit must not vanish.
      editMessage: async (_messageId, content) => send(messengerContentText(content)),
      removeReaction: () => Promise.resolve(),
      triggerTyping: async () => {
        if (isHandle(target)) return;
        try {
          await api.startTyping(target);
        } catch (error) {
          log('triggerTyping failed: %O', error);
        }
      },
    };
  }

  extractChatId(platformThreadId: string): string {
    return decodeLinqThreadId(platformThreadId);
  }

  formatMarkdown(markdown: string): string {
    return markdownToPlainText(markdown);
  }

  parseMessageId(compositeId: string): string {
    return compositeId;
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}
}
