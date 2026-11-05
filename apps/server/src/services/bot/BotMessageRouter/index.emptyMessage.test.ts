import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  makeProvider,
  mockFindEnabledByPlatform,
  mockHandleMention,
  mockHandleSubscribedMessage,
  mockOnNewMention,
  mockOnNewMessage,
  mockOnSubscribedMessage,
  resetBotMessageRouterMocks,
} from './testUtils';
import { isEmptyInboundMessage } from './utils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', async () => (await import('./testUtils')).appModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

type Handler = (thread: any, message: any, ctx?: any) => Promise<void>;

const author = { isBot: false, userId: 'alice-id', userName: 'alice' };
const image = { mimeType: 'image/png', name: 'a.png', type: 'image' };

const dmThread = () => ({
  id: 'telegram:chat-1',
  isDM: true,
  post: vi.fn().mockResolvedValue(undefined),
});

async function loadHandlers() {
  mockFindEnabledByPlatform.mockResolvedValue([
    makeProvider({ applicationId: 'app-1', settings: { dmPolicy: 'open' } }),
  ]);
  const router = new BotMessageRouter();
  await router.getWebhookHandler(
    'telegram',
    'app-1',
  )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));

  const catchAll = mockOnNewMessage.mock.calls.find(
    (call) => call[0] instanceof RegExp && call[0].source === '.',
  );
  const mention = mockOnNewMention.mock.calls.at(-1);
  const subscribed = mockOnSubscribedMessage.mock.calls.at(-1);
  if (!catchAll || !mention || !subscribed) throw new Error('handlers not registered');
  return {
    catchAll: catchAll[1] as Handler,
    mention: mention[0] as Handler,
    subscribed: subscribed[0] as Handler,
  };
}

describe('isEmptyInboundMessage', () => {
  it('is empty for blank text without attachments or a quote', () => {
    expect(isEmptyInboundMessage({ author, text: '' } as any)).toBe(true);
    expect(isEmptyInboundMessage({ author, text: ' \n\t' } as any)).toBe(true);
    expect(isEmptyInboundMessage({ author } as any)).toBe(true);
  });

  it('keeps text, attachment-only and quoted replies', () => {
    expect(isEmptyInboundMessage({ author, text: 'hi' } as any)).toBe(false);
    expect(isEmptyInboundMessage({ attachments: [image], author, text: '' } as any)).toBe(false);
    expect(isEmptyInboundMessage({ author, raw: { parent_id: 'om_1' }, text: '' } as any)).toBe(
      false,
    );
    expect(isEmptyInboundMessage({ author, raw: { reply_to_message: {} }, text: '' } as any)).toBe(
      false,
    );
  });
});

describe('BotMessageRouter empty inbound messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
  });

  describe.each([
    ['onNewMention', 'mention', mockHandleMention],
    ['onSubscribedMessage', 'subscribed', mockHandleSubscribedMessage],
    ['catch-all', 'catchAll', mockHandleMention],
  ] as const)('%s', (_name, key, dispatch) => {
    it('drops blank text without attachments', async () => {
      const handlers = await loadHandlers();
      const thread = dmThread();

      await handlers[key](thread, { author, id: 'm-1', isMention: true, text: '  \n ' });

      expect(dispatch).not.toHaveBeenCalled();
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('drops a debounced burst where every message is blank', async () => {
      const handlers = await loadHandlers();

      await handlers[key](
        dmThread(),
        { author, id: 'm-2', isMention: true, text: '' },
        { skipped: [{ author, id: 'm-1', text: ' ' }] },
      );

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('dispatches an attachment-only message', async () => {
      const handlers = await loadHandlers();

      await handlers[key](dmThread(), {
        attachments: [image],
        author,
        id: 'm-1',
        isMention: true,
        text: '',
      });

      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('dispatches a blank message when a debounced sibling carried text', async () => {
      const handlers = await loadHandlers();

      await handlers[key](
        dmThread(),
        { author, id: 'm-2', isMention: true, text: '' },
        { skipped: [{ author, id: 'm-1', text: 'hello' }] },
      );

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][1].text).toBe('hello');
    });

    it('dispatches normal text', async () => {
      const handlers = await loadHandlers();

      await handlers[key](dmThread(), { author, id: 'm-1', isMention: true, text: 'hello' });

      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
