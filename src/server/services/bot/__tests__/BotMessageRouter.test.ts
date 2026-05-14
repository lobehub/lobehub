import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from '../BotMessageRouter';

// ==================== Hoisted mocks ====================

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockProviderFindById = vi.hoisted(() => vi.fn());
const mockProviderUpdate = vi.hoisted(() => vi.fn());
const mockPeekPairingRequest = vi.hoisted(() => vi.fn());
const mockDeletePairingRequest = vi.hoisted(() => vi.fn());
const mockReleasePairingClaim = vi.hoisted(() => vi.fn());
const mockCreateOrGetPairingRequest = vi.hoisted(() => vi.fn());
const mockGetAgentRuntimeRedisClient = vi.hoisted(() => vi.fn().mockReturnValue(null));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => {
  // Constructor returns the same set of instance-method mocks so tests
  // can assert / configure without grabbing a per-instance reference.
  const ctor = vi.fn().mockImplementation(() => ({
    findById: mockProviderFindById,
    update: mockProviderUpdate,
  }));
  // Preserve the static method other tests rely on (load path).
  (
    ctor as unknown as { findEnabledByPlatform: typeof mockFindEnabledByPlatform }
  ).findEnabledByPlatform = mockFindEnabledByPlatform;
  return { AgentBotProviderModel: ctor };
});

vi.mock('../dmPairingStore', () => ({
  consumePairingRequest: vi.fn(),
  createOrGetPairingRequest: mockCreateOrGetPairingRequest,
  deletePairingRequest: mockDeletePairingRequest,
  peekPairingRequest: mockPeekPairingRequest,
  releasePairingClaim: mockReleasePairingClaim,
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
}));

// Stub appEnv so accessing `appEnv.APP_URL` in vitest doesn't trip
// `@t3-oss/env-nextjs`'s client-side access guard.
vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'http://localhost:3010',
  },
}));

vi.mock('@chat-adapter/state-ioredis', () => ({
  createIoRedisState: vi.fn(),
}));

// Mock Chat SDK
const mockInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOnNewMention = vi.hoisted(() => vi.fn());
const mockOnSubscribedMessage = vi.hoisted(() => vi.fn());
const mockOnNewMessage = vi.hoisted(() => vi.fn());
const mockOnSlashCommand = vi.hoisted(() => vi.fn());

vi.mock('chat', () => ({
  BaseFormatConverter: class {},
  Chat: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    onNewMention: mockOnNewMention,
    onNewMessage: mockOnNewMessage,
    onSlashCommand: mockOnSlashCommand,
    onSubscribedMessage: mockOnSubscribedMessage,
    webhooks: {},
  })),
  ConsoleLogger: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    interruptTask: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

const mockHandleMention = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockHandleSubscribedMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: vi.fn().mockImplementation(() => ({
    handleMention: mockHandleMention,
    handleSubscribedMessage: mockHandleSubscribedMessage,
  })),
}));

// Mock platform entries
const mockCreateAdapter = vi.hoisted(() =>
  vi.fn().mockReturnValue({ testplatform: { type: 'mock-adapter' } }),
);
const mockMergeWithDefaults = vi.hoisted(() =>
  vi.fn((_: unknown, settings?: Record<string, unknown>) => settings ?? {}),
);
const mockResolveBotProviderConfig = vi.hoisted(() =>
  vi.fn(
    (
      platform: { id: string; schema?: unknown },
      provider: {
        applicationId: string;
        credentials: Record<string, string>;
        settings?: Record<string, unknown> | null;
      },
    ) => {
      const settings = mockMergeWithDefaults(platform.schema, provider.settings ?? undefined);
      return {
        config: {
          applicationId: provider.applicationId,
          credentials: provider.credentials,
          platform: platform.id,
          settings,
        },
        connectionMode: 'webhook' as const,
        settings,
      };
    },
  ),
);

const mockGetPlatform = vi.hoisted(() =>
  vi.fn().mockImplementation((platform: string) => {
    if (platform === 'unknown') return undefined;
    return {
      clientFactory: {
        createClient: vi.fn().mockReturnValue({
          applicationId: 'mock-app',
          createAdapter: mockCreateAdapter,
          extractAuthorLocale: (msg: any) => msg?.raw?.from?.language_code,
          // Match the per-platform contract: return the most-specific raw
          // ID (last segment of the composite). Telegram `telegram:chat-1`
          // → `chat-1`; Discord `discord:guild:channel:thread` → `thread`.
          extractChatId: (id: string) => id.split(':').at(-1) ?? '',
          // Mirrors Discord's `extraGroupAllowlistChannels`: when the
          // platformThreadId has a thread segment, surface the parent
          // channel as an extra allowlist candidate. Two-segment IDs
          // (Telegram-style `telegram:chat-1`) return [], leaving
          // existing tests unaffected.
          extraGroupAllowlistChannels: (threadId: string) => {
            const parts = threadId.split(':');
            return parts.length === 4 && parts[2] ? [parts[2]] : [];
          },
          getMessenger: () => ({
            createMessage: vi.fn(),
            editMessage: vi.fn(),
            removeReaction: vi.fn(),
            triggerTyping: vi.fn(),
          }),
          id: platform,
          parseMessageId: (id: string) => id,
          start: vi.fn(),
          stop: vi.fn(),
        }),
      },
      credentials: [],
      id: platform,
      name: platform,
    };
  }),
);

// Mirrors the real `parseIdList` in ../platforms/const.ts: accepts the new
// `[{ id, name? }]` shape plus the legacy string / string[] shapes that
// existing data on disk may still be in.
const parseAllowlistMock = vi.hoisted(() => (raw: unknown): string[] => {
  if (typeof raw === 'string') {
    return raw
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object' && 'id' in entry) {
          const id = (entry as { id?: unknown }).id;
          return typeof id === 'string' ? id.trim() : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
});

vi.mock('../platforms', () => ({
  buildRuntimeKey: (platform: string, appId: string) => `${platform}:${appId}`,
  getBotReplyLocale: (platform: string | undefined): string => {
    if (platform === 'feishu' || platform === 'qq' || platform === 'wechat') return 'zh-CN';
    return 'en-US';
  },
  normalizeBotReplyLocale: (raw: string | undefined | null): string | undefined => {
    if (!raw) return undefined;
    const parts = raw.replaceAll('_', '-').split('-');
    const formatted =
      parts.length === 1
        ? parts[0].toLowerCase()
        : `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
    // Keep this in sync with the project `normalizeLocale` for the cases we test:
    // - exact match returns as-is
    // - 'zh-CN' / 'pt-BR' / 'en-US' are project locales
    // - unknown → 'en-US'
    const known = new Set(['en-US', 'zh-CN', 'zh-TW', 'pt-BR', 'ja-JP', 'ko-KR', 'fr-FR']);
    if (known.has(formatted)) return formatted;
    return 'en-US';
  },
  extractDmSettings: (settings: Record<string, unknown> | null | undefined) => {
    const rawPolicy = settings?.dmPolicy as string | undefined;
    const policy =
      rawPolicy === 'allowlist' ||
      rawPolicy === 'open' ||
      rawPolicy === 'disabled' ||
      rawPolicy === 'pairing'
        ? rawPolicy
        : 'open';
    return { policy };
  },
  normalizeAllowFromEntries: (raw: unknown): Array<{ id: string; name?: string }> => {
    if (typeof raw === 'string') {
      return raw
        .split(/[\s,]+/)
        .map((id: string) => id.trim())
        .filter(Boolean)
        .map((id: string) => ({ id }));
    }
    if (Array.isArray(raw)) {
      const out: Array<{ id: string; name?: string }> = [];
      for (const entry of raw) {
        if (typeof entry === 'string') {
          const id = entry.trim();
          if (id) out.push({ id });
          continue;
        }
        if (entry && typeof entry === 'object' && 'id' in entry) {
          const id = (entry as { id?: unknown }).id;
          if (typeof id !== 'string' || !id.trim()) continue;
          const name = (entry as { name?: unknown }).name;
          out.push(
            typeof name === 'string' && name.trim()
              ? { id: id.trim(), name: name.trim() }
              : { id: id.trim() },
          );
        }
      }
      return out;
    }
    return [];
  },
  extractGroupSettings: (settings: Record<string, unknown> | null | undefined) => {
    const allowFrom = parseAllowlistMock(settings?.groupAllowFrom);
    const rawPolicy = settings?.groupPolicy as string | undefined;
    const policy =
      rawPolicy === 'allowlist' || rawPolicy === 'open' || rawPolicy === 'disabled'
        ? rawPolicy
        : 'open';
    return { allowFrom, policy };
  },
  extractUserAllowlist: (settings: Record<string, unknown> | null | undefined) => {
    const explicit = parseAllowlistMock(settings?.allowFrom);
    if (explicit.length === 0) return { ids: [] };
    const operatorId = (settings?.userId as string | undefined)?.trim();
    if (!operatorId || explicit.includes(operatorId)) return { ids: explicit };
    return { ids: [...explicit, operatorId] };
  },
  mergeWithDefaults: mockMergeWithDefaults,
  platformRegistry: {
    getPlatform: mockGetPlatform,
  },
  resolveBotProviderConfig: mockResolveBotProviderConfig,
  shouldAllowSender: (params: {
    authorUserId: string | undefined;
    userAllowlist: { ids: string[] };
  }) => {
    if (params.userAllowlist.ids.length === 0) return true;
    if (!params.authorUserId) return false;
    return params.userAllowlist.ids.includes(params.authorUserId);
  },
  shouldHandleDm: (params: {
    authorUserId: string | undefined;
    dmSettings: { policy: 'allowlist' | 'disabled' | 'open' | 'pairing' };
    isDM: boolean;
    operatorUserId?: string;
    userAllowlist: { ids: string[] };
  }): 'allow' | 'pair' | 'reject' => {
    if (!params.isDM) return 'allow';
    if (params.dmSettings.policy === 'disabled') return 'reject';
    if (params.dmSettings.policy === 'open') return 'allow';
    if (!params.authorUserId) return 'reject';
    if (
      params.dmSettings.policy === 'pairing' &&
      params.operatorUserId &&
      params.authorUserId === params.operatorUserId
    ) {
      return 'allow';
    }
    const inList =
      params.userAllowlist.ids.length > 0 && params.userAllowlist.ids.includes(params.authorUserId);
    if (inList) return 'allow';
    return params.dmSettings.policy === 'pairing' ? 'pair' : 'reject';
  },
  shouldHandleGroup: (params: {
    candidateChannelIds: ReadonlyArray<string | undefined>;
    groupSettings: { allowFrom: string[]; policy: 'allowlist' | 'disabled' | 'open' };
    isDM: boolean;
  }) => {
    if (params.isDM) return true;
    if (params.groupSettings.policy === 'disabled') return false;
    if (params.groupSettings.policy === 'open') return true;
    const ids = params.candidateChannelIds.filter((id): id is string => Boolean(id));
    if (ids.length === 0) return false;
    return ids.some((id) => params.groupSettings.allowFrom.includes(id));
  },
}));

// ==================== Helpers ====================

const FAKE_DB = {} as any;
const FAKE_GATEKEEPER = { decrypt: vi.fn() };

function makeProvider(overrides: Record<string, any> = {}) {
  return {
    agentId: 'agent-1',
    applicationId: 'app-123',
    credentials: { botToken: 'token' },
    userId: 'user-1',
    ...overrides,
  };
}

// ==================== Tests ====================

describe('BotMessageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(FAKE_DB);
    mockInitWithEnvKey.mockResolvedValue(FAKE_GATEKEEPER);
    mockFindEnabledByPlatform.mockResolvedValue([]);
    mockHandleMention.mockResolvedValue(undefined);
    mockHandleSubscribedMessage.mockResolvedValue(undefined);
    // Reset pairing-store + provider-model mocks to safe defaults so a
    // previous test's stub doesn't leak into the next one.
    mockPeekPairingRequest.mockResolvedValue(null);
    mockDeletePairingRequest.mockResolvedValue(undefined);
    mockReleasePairingClaim.mockResolvedValue(undefined);
    mockCreateOrGetPairingRequest.mockResolvedValue({ status: 'redis-unavailable' });
    mockProviderFindById.mockResolvedValue(undefined);
    mockProviderUpdate.mockResolvedValue(undefined);
    mockGetAgentRuntimeRedisClient.mockReturnValue(null);
  });

  describe('getWebhookHandler', () => {
    it('should return 404 for unknown platform', async () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('unknown');

      const req = new Request('https://example.com/webhook', { method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(404);
      expect(await resp.text()).toBe('No bot configured for this platform');
    });

    it('should return a handler function', () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      expect(typeof handler).toBe('function');
    });
  });

  describe('on-demand loading', () => {
    it('should load bot on first webhook request', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-bot-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Should only query the specific platform, not all platforms
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
      expect(mockFindEnabledByPlatform).toHaveBeenCalledWith(FAKE_DB, 'telegram', FAKE_GATEKEEPER);

      // Chat SDK should be initialized
      expect(mockInitialize).toHaveBeenCalled();
      expect(mockCreateAdapter).toHaveBeenCalled();
    });

    it('should return cached bot on subsequent requests', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-bot-123');

      const req1 = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req1);

      const req2 = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req2);

      // DB should only be queried once — second call uses cache
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('should return 404 when no provider found in DB', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'non-existent');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(404);
    });

    it('should return 400 when appId is missing for generic platform', async () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(400);
    });

    it('should handle DB errors gracefully', async () => {
      mockFindEnabledByPlatform.mockRejectedValue(new Error('DB connection failed'));

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      // Should return 404, not throw
      expect(resp.status).toBe(404);
    });
  });

  describe('handler registration', () => {
    it('should always register onNewMention and onSubscribedMessage', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      expect(mockOnNewMention).toHaveBeenCalled();
      expect(mockOnSubscribedMessage).toHaveBeenCalled();
    });

    it('should register onNewMessage when DM policy is not disabled', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'tg-123',
          settings: { dmPolicy: 'open' },
        }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called twice: once for text-based slash commands, once for DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(2);
    });

    it('should NOT register DM onNewMessage when DM policy is disabled', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-123',
          settings: { dmPolicy: 'disabled' },
        }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called once for text-based slash commands only, no DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('onSubscribedMessage policy', () => {
    /**
     * Boot the router so its handler registration runs, then return the
     * `onSubscribedMessage` handler that was registered with the Chat SDK
     * so tests can invoke it directly with synthetic thread/message objects.
     */
    async function loadSubscribedHandler(settings?: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: settings ?? { dmPolicy: 'open' },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnSubscribedMessage.mock.calls.at(-1);
      if (!lastCall) throw new Error('onSubscribedMessage was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    function makeThread(overrides: Partial<{ id: string; isDM: boolean }> = {}) {
      return {
        id: 'telegram:chat-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    function makeMessage(
      overrides: Partial<{ isMention: boolean; text: string; userId: string }> = {},
    ) {
      const { userId = 'alice-id', ...rest } = overrides;
      return {
        author: { isBot: false, userId, userName: 'alice' },
        isMention: false,
        text: 'hello there',
        ...rest,
      };
    }

    it('should skip non-mention messages in group threads', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: false, text: 'just chatting with bob' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should respond to @-mentions in group threads', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: '@bot what about this' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should respond to every message in DM threads (no mention required)', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should respond when a debounced/skipped earlier message contained the mention', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const skipped = [
        makeMessage({ isMention: true, text: '@bot first question' }),
        makeMessage({ isMention: false, text: 'and one more thing' }),
      ];
      const message = makeMessage({ isMention: false, text: 'last bit' });

      await handler(thread, message, { skipped, totalSinceLastHandler: 3 });

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should ignore messages from other bots', async () => {
      const handler = await loadSubscribedHandler();
      const thread = makeThread({ isDM: false });
      const message = {
        author: { isBot: true, userId: 'other-bot-id', userName: 'other-bot' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
    });

    it('should block DM follow-ups when DM is disabled and notify the sender', async () => {
      const handler = await loadSubscribedHandler({ dmPolicy: 'disabled' });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('should block DM follow-ups for users outside the allowlist and notify the sender', async () => {
      const handler = await loadSubscribedHandler({
        allowFrom: 'bob-id, carol-id',
        dmPolicy: 'allowlist',
      });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi', userId: 'alice-id' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('should pass DM follow-ups for users on the allowlist', async () => {
      const handler = await loadSubscribedHandler({
        allowFrom: 'alice-id, bob-id',
        dmPolicy: 'allowlist',
      });
      const thread = makeThread({ isDM: true });
      const message = makeMessage({ isMention: false, text: 'hi', userId: 'alice-id' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('should not affect group @-mentions when DM is disabled', async () => {
      const handler = await loadSubscribedHandler({ dmPolicy: 'disabled' });
      const thread = makeThread({ isDM: false });
      const message = makeMessage({ isMention: true, text: '@bot hi' });

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('onNewMention DM policy', () => {
    async function loadMentionHandler(settings?: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: settings ?? { dmPolicy: 'open' },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('should allow group @-mentions regardless of DM policy', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('should block @-mentions inside DMs when DM is disabled and notify the sender', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'discord:@me:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('should propagate sender + isOwner=true on botContext when the owner @s the bot', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'open', userId: 'owner-platform-id' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-platform-id', userName: 'owner' },
        isMention: true,
        text: '@bot run a tool',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.senderExternalUserId).toBe('owner-platform-id');
      expect(opts.botContext.isOwner).toBe(true);
    });

    it('should propagate sender + isOwner=false on botContext when an external user @s the bot', async () => {
      const handler = await loadMentionHandler({ dmPolicy: 'open', userId: 'owner-platform-id' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'random-user-id', userName: 'random' },
        isMention: true,
        text: '@bot rm -rf',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.senderExternalUserId).toBe('random-user-id');
      expect(opts.botContext.isOwner).toBe(false);
    });

    it('should fall back to isOwner=false when settings.userId is missing (fail-closed)', async () => {
      // No `userId` configured on the bot — even a sender who happens to
      // share an ID with the operator can't claim owner status.
      const handler = await loadMentionHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'someone', userName: 'someone' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      const opts = mockHandleMention.mock.calls[0][2];
      expect(opts.botContext.isOwner).toBe(false);
    });

    it('should block DM @-mentions from users outside the allowlist and notify the sender', async () => {
      const handler = await loadMentionHandler({
        allowFrom: 'bob-id',
        dmPolicy: 'allowlist',
      });
      const thread = {
        id: 'discord:@me:channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });
  });

  describe('onNewMessage DM catch-all', () => {
    async function loadDmCatchAllHandler(settings?: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: settings ?? { dmPolicy: 'open' },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      // The catch-all is the onNewMessage registration with the /./ pattern.
      // The first onNewMessage registration is for text-based slash commands
      // with a specific command regex.
      const catchAllCall = mockOnNewMessage.mock.calls.find((call) => {
        const pattern = call[0];
        return pattern instanceof RegExp && pattern.source === '.';
      });
      if (!catchAllCall) return null;
      return catchAllCall[1] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('should not register the DM catch-all when DM is disabled', async () => {
      const handler = await loadDmCatchAllHandler({ dmPolicy: 'disabled' });
      expect(handler).toBeNull();
    });

    it('should register the DM catch-all when DM is enabled', async () => {
      const handler = await loadDmCatchAllHandler({ dmPolicy: 'open' });
      expect(handler).not.toBeNull();
    });

    it('should ignore non-DM threads in the catch-all', async () => {
      const handler = await loadDmCatchAllHandler();
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:group-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hello from a group',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('should handle DM messages through the catch-all', async () => {
      const handler = await loadDmCatchAllHandler();
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hi in a DM',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('should block DM messages blocked by the allowlist and notify the sender', async () => {
      const handler = await loadDmCatchAllHandler({
        allowFrom: 'bob-id',
        dmPolicy: 'allowlist',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        text: 'hi in a DM',
      };

      await handler(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('lets pairing-mode strangers reach the DM gate (does NOT short-circuit on allowFrom)', async () => {
      // Regression: previously, the global `allowFrom` gate ran first and
      // rejected anyone not on the list — including strangers DMing a
      // pairing bot, who never reached the pairing flow. With pairing,
      // `allowFrom` is the *post-approval* list (managed by `/approve`),
      // so the global gate must skip on DM threads under pairing.
      const handler = await loadDmCatchAllHandler({
        // allowFrom only contains the operator — Lin is a stranger here.
        allowFrom: [{ id: 'owner-id', name: 'me' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'Lin' },
        text: 'Hi',
      };

      await handler(thread, message);

      // No agent dispatch (gate didn't pass through to the agent)
      expect(mockHandleMention).not.toHaveBeenCalled();
      // Post was made — but it must NOT be the allowlist rejection text
      // (which is what the bug rendered). With redis mocked to null in
      // this suite the pairing flow falls back to the "unavailable"
      // copy; the important thing is we left the global-allowFrom branch
      // and entered the pairing branch.
      expect(thread.post).toHaveBeenCalledTimes(1);
      const text = thread.post.mock.calls[0][0] as string;
      expect(text).not.toContain("aren't authorized");
      expect(text).toContain('Pairing');
    });

    it('owner DMing a pairing bot bypasses the gate via operator-bypass', async () => {
      // Even with allowFrom not yet populated with anyone but the owner,
      // the owner themselves must be able to DM the bot to test it /
      // approve other users.
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-id', userName: 'me' },
        text: 'self test',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('owner bypasses the gate from any channel context (slash-command DM/group safety net)', async () => {
      // Discord's native slash-command events sometimes deliver DM
      // invocations with `event.channel.isDM=false`, which would otherwise
      // route the owner's `/approve` through the group gate and reject
      // them when their channel isn't in `groupAllowFrom`. The operator
      // override neutralises this for any inbound from the bot's owner.
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }],
        dmPolicy: 'pairing',
        groupAllowFrom: [{ id: 'allowed-channel' }],
        groupPolicy: 'allowlist',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      // Mis-reported isDM=false on a DM-y thread — channel id is NOT in
      // groupAllowFrom; without owner override the group gate would
      // reject. (The catch-all itself returns early on isDM!==true, so
      // we use isDM=true here; the assertion is that the DM path lets
      // owner through under the strictest combination of policies.)
      const thread = {
        id: 'discord:dm-channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'owner-id', userName: 'me' },
        text: 'self test',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('previously-approved users on a pairing bot pass straight through (no re-pairing)', async () => {
      const handler = await loadDmCatchAllHandler({
        allowFrom: [{ id: 'owner-id' }, { id: 'lin-id', name: 'Lin' }],
        dmPolicy: 'pairing',
        userId: 'owner-id',
      });
      if (!handler) throw new Error('expected catch-all to be registered');
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'Lin' },
        text: 'Hello again',
      };

      await handler(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      // No pairing notice was posted — Lin is already approved.
      expect(thread.post).not.toHaveBeenCalled();
    });
  });

  describe('group policy', () => {
    /**
     * Returns the registered onSubscribedMessage and onNewMention handlers so
     * group-policy assertions can drive each entry point with the same
     * fixture.
     */
    async function loadHandlers(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const sub = mockOnSubscribedMessage.mock.calls.at(-1);
      const mention = mockOnNewMention.mock.calls.at(-1);
      if (!sub || !mention) throw new Error('handlers not registered');
      return {
        mention: mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
        subscribed: sub[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
      };
    }

    function makeGroupThread(channelId: string) {
      return {
        channelId,
        id: `telegram:${channelId}`,
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
    }

    function makeMentionMessage() {
      return {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };
    }

    it('blocks @-mentions in groups when group policy is disabled and notifies the sender', async () => {
      const { subscribed } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = makeGroupThread('channel-1');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("doesn't respond in groups or channels");
    });

    it('blocks @-mentions on the new-mention path when group policy is disabled', async () => {
      const { mention } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = makeGroupThread('channel-1');

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("doesn't respond in groups or channels");
    });

    it('allows @-mentions in channels listed in groupAllowFrom', async () => {
      const { subscribed } = await loadHandlers({
        groupAllowFrom: 'channel-1, channel-2',
        groupPolicy: 'allowlist',
      });
      const thread = makeGroupThread('channel-1');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });

    it('blocks @-mentions in channels outside groupAllowFrom and notifies the sender', async () => {
      const { subscribed } = await loadHandlers({
        groupAllowFrom: 'channel-1',
        groupPolicy: 'allowlist',
      });
      const thread = makeGroupThread('channel-9');

      await subscribed(thread, makeMentionMessage());

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
    });

    it('allows Discord @-mentions when the operator allowlisted ONLY the auto-thread ID', async () => {
      // Operator wants to allow exactly one specific thread (e.g. they
      // copied the thread ID from Discord directly). The router uses
      // `extractChatId` (= the most-specific raw ID, here the thread) as
      // the primary candidate, so an allowlist holding just the thread ID
      // matches.
      const { mention } = await loadHandlers({
        groupAllowFrom: 'auto-thread-id',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('allows Discord @-mentions when the operator allowlisted the PARENT channel', async () => {
      // Real-world bug: operator pastes the parent channel ID
      // (`parent-channel`) into groupAllowFrom; Discord auto-creates a
      // reply thread for the @-mention so `thread.channelId` is the
      // ephemeral thread ID, not the parent. The router asks the platform
      // client for extra allowlist candidates and accepts the message
      // because the parent matches.
      const { mention } = await loadHandlers({
        groupAllowFrom: 'parent-channel',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('blocks Discord @-mentions when neither the thread nor parent are allowlisted', async () => {
      const { mention } = await loadHandlers({
        groupAllowFrom: 'some-other-channel',
        groupPolicy: 'allowlist',
      });
      const thread = {
        channelId: 'auto-thread-id',
        id: 'discord:guild-1:parent-channel:auto-thread-id',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, makeMentionMessage());

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
    });

    it('does not affect DMs when group policy is disabled', async () => {
      const { subscribed } = await loadHandlers({ groupPolicy: 'disabled' });
      const thread = {
        channelId: 'dm-channel',
        id: 'telegram:dm',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await subscribed(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        text: 'hi in DM',
      });

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('global allowFrom (user-level identity gate)', () => {
    /**
     * Real-world bug report: DM Policy=Allowlist, allowFrom=[me], Group
     * Policy=Open. A non-allowlisted user @-mentioned the bot in a server
     * channel and the bot still tried to process — because the old
     * implementation only consumed allowFrom under `dmPolicy='allowlist'`
     * and isDM=true. Lock in: a populated allowFrom blocks every inbound
     * surface — DMs and group @mentions alike.
     */
    async function loadHandlers(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const sub = mockOnSubscribedMessage.mock.calls.at(-1);
      const mention = mockOnNewMention.mock.calls.at(-1);
      if (!sub || !mention) throw new Error('handlers not registered');
      return {
        mention: mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
        subscribed: sub[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
      };
    }

    it('blocks a non-allowlisted sender in a group and posts the generic notice in-thread', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hello',
      };

      await mention(thread, message);

      // Bot must not handle the message...
      expect(mockHandleMention).not.toHaveBeenCalled();
      // ...but must notify the sender in-thread with the generic
      // "interact with this bot" copy. On Discord the post lands in the
      // auto-created reply thread, so it does not pollute the parent
      // channel; on other platforms it lands in the same group/thread
      // the @mention came from, mirroring notifyGroupRejected.
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.post.mock.calls[0][0]).toContain('interact with this bot');
      // The generic copy intentionally avoids "direct messages" — the
      // sender did not try to DM, they @-mentioned in a group.
      expect(thread.post.mock.calls[0][0]).not.toContain('direct messages');
    });

    it('blocks a non-allowlisted sender in a DM (with notification)', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hi',
      };

      await mention(thread, message);

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
    });

    it('lets allowlisted senders through in a group', async () => {
      const { mention } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      };

      await mention(thread, message);

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it('blocks subscribed-thread non-allowlisted senders in groups with the generic notice', async () => {
      const { subscribed } = await loadHandlers({
        allowFrom: 'alice-id',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };

      await subscribed(thread, {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('interact with this bot');
    });

    it('with empty allowFrom acts as no-op, all senders allowed', async () => {
      const { mention } = await loadHandlers({
        allowFrom: '',
        dmPolicy: 'open',
        groupPolicy: 'open',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'random-user', userName: 'random' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });

    it("treats settings.userId as implicitly allowed when allowFrom doesn't list them (anti-lockout)", async () => {
      // The operator filled in `userId` (the AI-tools field) so AI can
      // push notifications to them, then later set `allowFrom` to scope
      // the bot to a couple of friends — forgetting to add themselves.
      // The router must still let the operator interact.
      const { mention } = await loadHandlers({
        allowFrom: 'friend-1, friend-2',
        dmPolicy: 'open',
        groupPolicy: 'open',
        userId: 'operator-id',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'operator-id', userName: 'me' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });

    it('does not flip the bot to private mode when only userId is set (allowFrom empty)', async () => {
      // The reverse safety check: a long-standing operator who only ever
      // configured `userId` for AI push must not suddenly find their bot
      // restricted to themselves once allowFrom-as-global-gate ships.
      const { mention } = await loadHandlers({
        dmPolicy: 'open',
        groupPolicy: 'open',
        userId: 'operator-id',
      });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
      };

      await mention(thread, {
        author: { isBot: false, userId: 'random-user', userName: 'random' },
        isMention: true,
        text: '@bot hi',
      });

      // Random user gets through because allowFrom is empty → no filter.
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
    });
  });

  describe('command access gates (P1: /commands must respect allowFrom + DM/group policy)', () => {
    /**
     * Real-world risk: command dispatch (`/new`, `/stop`) historically ran
     * BEFORE the allowFrom / DM-policy / group-policy checks. A blocked
     * sender could still side-effect — `/stop` cancelling an active run,
     * `/new` resetting thread state — even though normal messages were
     * rejected. Lock in: every command-dispatch path applies the same
     * access stack as the message handlers.
     */
    async function loadAllHandlers(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const sub = mockOnSubscribedMessage.mock.calls.at(-1);
      const mention = mockOnNewMention.mock.calls.at(-1);
      // The command-regex onNewMessage is registered LAST (after the DM
      // catch-all `/./`), so pick it by matching the `/(new|stop)` pattern.
      const cmdHandlerCall = mockOnNewMessage.mock.calls.find(
        (call) => call[0] instanceof RegExp && call[0].source.includes('new'),
      );
      const slashNewCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/new');
      const slashStopCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/stop');
      if (!sub || !mention || !cmdHandlerCall || !slashNewCall || !slashStopCall) {
        throw new Error('handlers not registered');
      }
      return {
        cmdRegexHandler: cmdHandlerCall[1] as (thread: any, message: any) => Promise<void>,
        mention: mention[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
        slashNew: slashNewCall[1] as (event: any) => Promise<void>,
        slashStop: slashStopCall[1] as (event: any) => Promise<void>,
        subscribed: sub[0] as (thread: any, message: any, ctx?: any) => Promise<void>,
      };
    }

    function makeChannel(overrides: Record<string, unknown> = {}) {
      return {
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('blocks a native /stop slash command from a non-allowlisted sender', async () => {
      const { slashStop } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const channel = makeChannel();
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'lin-id', userName: 'lin' },
      };

      await slashStop(event);

      // Rejection notice posted, but the command handler must not have
      // called setState or kicked off an interruptTask.
      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a native /new slash command in a disabled-DM channel', async () => {
      const { slashNew } = await loadAllHandlers({
        dmPolicy: 'disabled',
        groupPolicy: 'open',
      });
      const channel = makeChannel({ isDM: true });
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'alice-id', userName: 'alice' },
      };

      await slashNew(event);

      // DM rejection notice (mentions DMs / direct messages), no state reset.
      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toMatch(/direct message/i);
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a native slash command in a non-allowlisted group channel', async () => {
      const { slashNew } = await loadAllHandlers({
        groupAllowFrom: 'channel-2',
        groupPolicy: 'allowlist',
      });
      const channel = makeChannel({ id: 'telegram:channel-9', isDM: false });
      const event = {
        channel,
        text: '',
        user: { isBot: false, userId: 'alice-id', userName: 'alice' },
      };

      await slashNew(event);

      expect(channel.post).toHaveBeenCalledTimes(1);
      expect(channel.post.mock.calls[0][0]).toContain("isn't enabled in this channel");
      expect(channel.setState).not.toHaveBeenCalled();
    });

    it('blocks a text-based /new (Telegram regex path) from a non-allowlisted sender', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/new',
      };

      await cmdRegexHandler(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
    });

    it('blocks /stop typed in onNewMention as a command from a non-allowlisted sender', async () => {
      // Older code dispatched commands BEFORE the allowFrom check; this
      // test catches a regression where /stop in an @-mention slips through.
      const { mention } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: true,
        text: '@bot /stop',
      };

      await mention(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
      expect(mockHandleMention).not.toHaveBeenCalled();
    });

    it('blocks /new typed in onSubscribedMessage from a non-allowlisted sender', async () => {
      const { subscribed } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'lin-id', userName: 'lin' },
        isMention: false,
        text: '/new',
      };

      await subscribed(thread, message);

      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("aren't authorized");
      expect(thread.setState).not.toHaveBeenCalled();
    });

    it('still allows /commands from an allowlisted sender (gate does not break the happy path)', async () => {
      const { cmdRegexHandler } = await loadAllHandlers({ allowFrom: 'alice-id' });
      const thread = {
        channelId: 'channel-1',
        id: 'telegram:channel-1',
        isDM: false,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        text: '/new',
      };

      await cmdRegexHandler(thread, message);

      // /new resets the topic (replace=true) and posts a confirmation.
      expect(thread.setState).toHaveBeenCalledWith({ topicId: undefined }, { replace: true });
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).not.toContain("aren't authorized");
    });
  });

  describe('regression: nested settings.dm.policy is ignored', () => {
    /**
     * Original bug: the form persisted `settings.dmPolicy` (flat) but the
     * router read `settings.dm.policy` (nested), so every saved policy
     * silently fell back to `'open'` and DMs were never blocked. Lock that
     * direction in: the *flat* key is authoritative; the legacy nested
     * shape is dead.
     */
    it('a saved dmPolicy=disabled at the flat key blocks DMs end-to-end', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings: { dmPolicy: 'disabled' } }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      const handler = lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;

      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      await handler(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      });

      expect(mockHandleMention).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain("isn't accepting direct messages");
    });

    it('a legacy nested settings.dm.policy=disabled is IGNORED and DMs pass through', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          // Pre-bug-fix shape — nested object the form never actually wrote
          // to. extractDmSettings doesn't read this; policy falls back to
          // 'open', so the DM goes through.
          settings: { dm: { policy: 'disabled' } },
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnNewMention.mock.calls.at(-1);
      if (!lastCall) throw new Error('onNewMention was not registered');
      const handler = lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;

      const thread = {
        id: 'telegram:dm-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      await handler(thread, {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: true,
        text: '@bot hi',
      });

      // Nested shape is dead → policy resolved as 'open' → DM goes through.
      expect(mockHandleMention).toHaveBeenCalledTimes(1);
      expect(thread.post).not.toHaveBeenCalled();
    });
  });

  describe('per-message reply locale auto-detect', () => {
    /**
     * Boot the router so its handler registration runs, then return the
     * `onSubscribedMessage` handler — the easiest entry point to drive a
     * locale-detected DM rejection without mocking the bridge call.
     */
    async function loadHandler(settings: Record<string, unknown>) {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const lastCall = mockOnSubscribedMessage.mock.calls.at(-1);
      if (!lastCall) throw new Error('onSubscribedMessage was not registered');
      return lastCall[0] as (thread: any, message: any, ctx?: any) => Promise<void>;
    }

    it('passes the sender platform locale into the bridge call', async () => {
      const handler = await loadHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        raw: { from: { language_code: 'pt-br' } },
        text: 'olá',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      // pt-br → pt-BR via the project normalizeLocale
      expect(mockHandleSubscribedMessage.mock.calls[0][2].replyLocale).toBe('pt-BR');
    });

    it('falls back to the platform default locale when the sender locale is missing', async () => {
      const handler = await loadHandler({ dmPolicy: 'open' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        raw: {}, // no language_code → use platform default (en-US for Telegram)
        text: 'hi',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).toHaveBeenCalledTimes(1);
      expect(mockHandleSubscribedMessage.mock.calls[0][2].replyLocale).toBe('en-US');
    });

    it('uses the sender locale for the DM rejection notice copy', async () => {
      const handler = await loadHandler({ dmPolicy: 'disabled' });
      const thread = {
        id: 'telegram:chat-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
      };
      const message = {
        author: { isBot: false, userId: 'alice-id', userName: 'alice' },
        isMention: false,
        // Chinese-speaking user on Telegram (default en-US) — copy should
        // follow the sender, not the platform default.
        raw: { from: { language_code: 'zh-cn' } },
        text: '你好',
      };

      await handler(thread, message);

      expect(mockHandleSubscribedMessage).not.toHaveBeenCalled();
      expect(thread.post).toHaveBeenCalledTimes(1);
      expect(thread.post.mock.calls[0][0]).toContain('该机器人不接受私信');
    });
  });

  describe('/approve persistence failure', () => {
    /**
     * The /approve flow used to consume the pairing code from Redis
     * BEFORE writing the applicant onto allowFrom. If the DB write
     * failed (transient outage, missing provider row), the code was
     * lost yet the owner still saw a success message — leaving the
     * applicant locked out with no recoverable state. These tests pin
     * the corrected ordering: peek-then-persist-then-delete, with a
     * clear failure message and the code preserved for retry on
     * persistence errors.
     */
    async function loadApproveHandler(
      providerOverrides: Record<string, unknown> = {},
    ): Promise<(event: any) => Promise<void>> {
      mockGetAgentRuntimeRedisClient.mockReturnValue({} as any);
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-1',
          settings: {
            allowFrom: [{ id: 'owner-id' }],
            dmPolicy: 'pairing',
            userId: 'owner-id',
            ...providerOverrides,
          },
          userId: 'owner-id',
        }),
      ]);
      const router = new BotMessageRouter();
      const webhookHandler = router.getWebhookHandler('telegram', 'app-1');
      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await webhookHandler(req);

      const slashApproveCall = mockOnSlashCommand.mock.calls.find((c) => c[0] === '/approve');
      if (!slashApproveCall) throw new Error('expected /approve to be registered');
      return slashApproveCall[1] as (event: any) => Promise<void>;
    }

    function makeApproveEvent() {
      const channel = {
        id: 'telegram:dm-channel-1',
        isDM: true,
        post: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
      };
      return {
        channel,
        text: 'ABCD2345',
        user: { isBot: false, userId: 'owner-id', userName: 'owner' },
      };
    }

    const PAIRING_ENTRY = {
      applicantUserId: 'lin-id',
      applicantUserName: 'Lin',
      applicationId: 'app-1',
      code: 'ABCD2345',
      createdAt: 1_700_000_000_000,
      platform: 'telegram',
      replyLocale: 'en-US' as const,
      threadId: 'telegram:dm-lin',
    };

    it('reports failure and preserves the code when the DB update throws', async () => {
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }] },
      });
      mockProviderUpdate.mockRejectedValue(new Error('connection refused'));

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      // Owner sees the failure copy, not the success copy. This is the
      // core of the bug: a logged-and-swallowed error must NOT render
      // as a successful approval.
      expect(event.channel.post).toHaveBeenCalledTimes(1);
      const reply = event.channel.post.mock.calls[0][0] as string;
      expect(reply).not.toMatch(/Approved/i);
      expect(reply).toContain("Couldn't save");

      // Code is still in Redis so the owner can rerun /approve, and the
      // peek claim was released so the retry isn't blocked behind our
      // own 60s lock.
      expect(mockDeletePairingRequest).not.toHaveBeenCalled();
      expect(mockReleasePairingClaim).toHaveBeenCalledTimes(1);
    });

    it('reports failure when the provider row is missing', async () => {
      // Edge case: provider deleted between issuing the code and
      // approving it. Without this guard, the old code silently no-op'd
      // and posted "Approved" — now the owner sees the same failure
      // copy and can investigate.
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue(undefined);

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      expect(event.channel.post).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toContain("Couldn't save");
      expect(mockDeletePairingRequest).not.toHaveBeenCalled();
      expect(mockProviderUpdate).not.toHaveBeenCalled();
      expect(mockReleasePairingClaim).toHaveBeenCalledTimes(1);
    });

    it('happy path: persists, then deletes the code, then reports success', async () => {
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }] },
      });
      mockProviderUpdate.mockResolvedValue(undefined);

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      // Persist must precede delete — that's the whole point of the
      // refactor. Use invocationCallOrder to lock the sequence.
      const updateOrder = mockProviderUpdate.mock.invocationCallOrder[0];
      const deleteOrder = mockDeletePairingRequest.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(deleteOrder);

      expect(mockDeletePairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          applicantUserId: 'lin-id',
          applicationId: 'app-1',
          code: 'ABCD2345',
          platform: 'telegram',
        }),
      );

      expect(event.channel.post).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toMatch(/Approved Lin/i);
    });

    it('skips the DB write when the applicant is already on allowFrom but still cleans up the code', async () => {
      // Read-modify-write idempotency: a second /approve for the same
      // user shouldn't fail just because they're already in. The code
      // gets cleared either way so it can't be reused.
      mockPeekPairingRequest.mockResolvedValue(PAIRING_ENTRY);
      mockProviderFindById.mockResolvedValue({
        settings: { allowFrom: [{ id: 'owner-id' }, { id: 'lin-id', name: 'Lin' }] },
      });

      const slashApprove = await loadApproveHandler();
      const event = makeApproveEvent();
      await slashApprove(event);

      expect(mockProviderUpdate).not.toHaveBeenCalled();
      expect(mockDeletePairingRequest).toHaveBeenCalledTimes(1);
      expect(event.channel.post.mock.calls[0][0]).toMatch(/Approved Lin/i);
    });
  });
});
