/**
 * Shared doubles for the BotMessageRouter scenario suites.
 *
 * Each suite registers the module mocks itself (`vi.mock` is hoisted per
 * file) and delegates every factory to the matching `*Module` export here, so
 * all suites share one set of mock functions.
 */
import { vi } from 'vitest';

import type * as PlatformUtils from '../platforms/utils';

// ==================== Hoisted mocks ====================

export const mockFindEnabledByPlatform = vi.fn();
export const mockInitWithEnvKey = vi.fn();
export const mockGetServerDB = vi.fn();
export const mockProviderFindById = vi.fn();
export const mockProviderUpdate = vi.fn();
export const mockPeekPairingRequest = vi.fn();
export const mockDeletePairingRequest = vi.fn();
export const mockReleasePairingClaim = vi.fn();
export const mockCreateOrGetPairingRequest = vi.fn();
export const mockGetAgentRuntimeRedisClient = vi.fn().mockReturnValue(null);
export const mockGetBotFeatureAccessState = vi.fn();

/** Factory for `vi.mock('@/database/core/db-adaptor')`. */
export const dbAdaptorModule = () => ({
  getServerDB: mockGetServerDB,
});

/** Factory for `vi.mock('@/database/models/agentBotProvider')`. */
export const agentBotProviderModule = () => {
  // Constructor returns the same set of instance-method mocks so tests
  // can assert / configure without grabbing a per-instance reference.
  const ctor = vi.fn().mockImplementation(function () {
    return {
      findById: mockProviderFindById,
      update: mockProviderUpdate,
    };
  });
  // Preserve the static method other tests rely on (load path).
  (
    ctor as unknown as { findEnabledByPlatform: typeof mockFindEnabledByPlatform }
  ).findEnabledByPlatform = mockFindEnabledByPlatform;
  return { AgentBotProviderModel: ctor };
};

/** Factory for `vi.mock('../dmPairingStore')`. */
export const dmPairingStoreModule = () => ({
  consumePairingRequest: vi.fn(),
  createOrGetPairingRequest: mockCreateOrGetPairingRequest,
  deletePairingRequest: mockDeletePairingRequest,
  peekPairingRequest: mockPeekPairingRequest,
  releasePairingClaim: mockReleasePairingClaim,
});

/** Factory for `vi.mock('@/server/modules/KeyVaultsEncrypt')`. */
export const keyVaultsEncryptModule = () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
});

/** Factory for `vi.mock('@/server/modules/AgentRuntime/redis')`. */
export const redisModule = () => ({
  getAgentRuntimeRedisClient: mockGetAgentRuntimeRedisClient,
});

/** Factory for `vi.mock('@/business/server/bot/featureAccess')`. */
export const featureAccessModule = () => ({
  getBotFeatureAccessState: mockGetBotFeatureAccessState,
});

// Stub appEnv so accessing `appEnv.APP_URL` in vitest doesn't trip
// `@t3-oss/env-nextjs`'s client-side access guard.
/** Factory for `vi.mock('@/envs/app')`. */
export const appModule = () => ({
  appEnv: {
    APP_URL: 'http://localhost:3010',
  },
});

/**
 * Factory for `vi.mock('@/server/featureFlags')`: the runtime flags with `bot_wake` on or off.
 * Routers read the flag from the bot owner's runtime flags, so a test that exercises the bot-wake
 * pipeline has to turn it on explicitly, exactly like a rollout does.
 */
export const featureFlagsModule = (enableBotWake = true) => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn().mockResolvedValue({ enableBotWake }),
});

/** Factory for `vi.mock('@chat-adapter/state-ioredis')`. */
export const stateIoredisModule = () => ({
  createIoRedisState: vi.fn(),
});

// Mock Chat SDK
export const mockInitialize = vi.fn().mockResolvedValue(undefined);
export const mockOnNewMention = vi.fn();
export const mockOnSubscribedMessage = vi.fn();
export const mockOnNewMessage = vi.fn();
export const mockOnSlashCommand = vi.fn();
export const mockWebhookHandler = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));
// Default state mocks for the participant tracking. Tests that
// care about the multi-human transition reassign `mockGetList` to seed the
// pre-existing participant list.
export const mockGetList = vi.fn().mockResolvedValue([]);
export const mockAppendToList = vi.fn().mockResolvedValue(undefined);
export const mockStateSetIfNotExists = vi.fn().mockResolvedValue(true);
export const mockDispatchToHandlers = vi.fn();
export const mockProcessMessage = vi.fn().mockResolvedValue(undefined);
export const mockDrainDeferredBotMessages = vi.fn().mockResolvedValue([]);
export const mockBuildReplayMessages = vi.fn();

/** Factory for `vi.mock('chat')`. */
export const chatModule = () => ({
  BaseFormatConverter: class {},
  Chat: vi.fn().mockImplementation(function () {
    return {
      dispatchToHandlers: mockDispatchToHandlers,
      getState: vi.fn(() => ({
        appendToList: mockAppendToList,
        getList: mockGetList,
        setIfNotExists: mockStateSetIfNotExists,
      })),
      initialize: mockInitialize,
      onNewMention: mockOnNewMention,
      onNewMessage: mockOnNewMessage,
      onSlashCommand: mockOnSlashCommand,
      onSubscribedMessage: mockOnSubscribedMessage,
      processMessage: mockProcessMessage,
      webhooks: mockChatWebhooks,
    };
  }),
  ConsoleLogger: vi.fn(),
});

/** Factory for `vi.mock('../deferredMessages')`. */
export const deferredMessagesModule = () => ({
  replayDeferredBotMessages: async (
    app: string,
    thread: string,
    replay: (entries: unknown[]) => Promise<void>,
  ) => {
    const entries = await mockDrainDeferredBotMessages(app, thread);
    if (entries.length) await replay(entries);
  },
});

/** Factory for `vi.mock('../mergeMessages')`. */
export const mergeMessagesModule = async (importOriginal: () => Promise<unknown>) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, buildReplayMessages: mockBuildReplayMessages };
};

/** Factory for `vi.mock('@/server/services/aiAgent')`. */
export const aiAgentModule = () => ({
  AiAgentService: vi.fn().mockImplementation(function () {
    return {
      interruptTask: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
});

export const mockHandleMention = vi.fn().mockResolvedValue(undefined);
export const mockHandleSubscribedMessage = vi.fn().mockResolvedValue(undefined);
export const mockAgentBridgeServiceCtor = vi.fn();
// Default to "platform does not opt into thread isolation" so existing tests
// keep their pre-behaviour. Individual tests can replace this via
// `.mockResolvedValueOnce(...)` to simulate Discord's auto-thread upgrade.
export const mockOpenThreadForChannelWake = vi.fn().mockResolvedValue(undefined);
/** What people call the bot; empty by default so only a test about naming opts in. */
export const mockGetBotNames = vi.fn().mockResolvedValue([]);
// Mirrors Discord's `ensureThreadMember`: pulls a platform user into the
// reply thread so they get notified. Optional on the PlatformClient
// contract — tests that care assert on it; others ignore the extra call.
export const mockEnsureThreadMember = vi.fn().mockResolvedValue(undefined);

/** Factory for `vi.mock('../AgentBridgeService')`. */
export const agentBridgeServiceModule = () => ({
  AgentBridgeService: Object.assign(mockAgentBridgeServiceCtor, {
    isThreadActive: () => false,
  }),
});

// Mock platform entries
export const mockCreateAdapter = vi
  .fn()
  .mockReturnValue({ testplatform: { type: 'mock-adapter' } });
export const mockReconcileWebhook = vi.fn().mockResolvedValue(undefined);
/** Per-platform webhook handlers exposed by the mocked Chat instance (`chat.webhooks`). */
export const mockChatWebhooks = { telegram: mockWebhookHandler } as Record<
  string,
  (req: Request, options?: any) => Promise<Response>
>;
export const mockMergeWithDefaults = vi.fn(function (
  _: unknown,
  settings?: Record<string, unknown>,
) {
  return settings ?? {};
});
export const mockResolveBotProviderConfig = vi.fn(function (
  platform: { id: string; schema?: unknown },
  provider: {
    applicationId: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown> | null;
  },
) {
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
});

export const mockGetPlatform = vi.fn().mockImplementation(function (platform: string) {
  if (platform === 'unknown') return undefined;
  return {
    clientFactory: {
      createClient: vi.fn().mockReturnValue({
        applicationId: 'mock-app',
        createAdapter: mockCreateAdapter,
        reconcileWebhook: mockReconcileWebhook,
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
        ensureThreadMember: mockEnsureThreadMember,
        getBotNames: mockGetBotNames,
        // Discord's: a top-level guild channel can move its reply into a thread. Threadless
        // platforms (Telegram, WeChat, QQ) offer no reply targets.
        ...(platform === 'discord' && {
          getReplyTargets: (threadId: string, message: { raw?: unknown }) => {
            const [, guildId, channelId, subThreadId] = threadId.split(':');
            if (!guildId || guildId === '@me' || !channelId || subThreadId) return undefined;

            return {
              channel: threadId,
              namesThread: true,
              openThread: (name?: string) =>
                mockOpenThreadForChannelWake(threadId, message.raw, name),
            };
          },
        }),
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
});

// Mirrors the real `parseIdList` in ../platforms/const.ts: accepts the new
// `[{ id, name? }]` shape plus the legacy string / string[] shapes that
// existing data on disk may still be in.
export const parseAllowlistMock = (raw: unknown): string[] => {
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
};

/** Factory for `vi.mock('../platforms')`. */
export const platformsModule = async () => ({
  buildRuntimeKey: (platform: string, appId: string) => `${platform}:${appId}`,
  // Pull the real resolver rather than restating it: these tests assert the
  // exact Chat SDK concurrency config a channel ends up with, and a stub would
  // only ever test itself. `utils` is safe to import for real — the barrel is
  // mocked because it instantiates every platform definition, `utils` does not.
  resolveBotConcurrency: (await vi.importActual<typeof PlatformUtils>('../platforms/utils'))
    .resolveBotConcurrency,
  getBotReplyLocale: (platform: string | undefined): string => {
    if (platform === 'feishu' || platform === 'qq' || platform === 'wechat') return 'zh-CN';
    return 'en-US';
  },
  normalizeBotReactionMode: (value: unknown) =>
    value === 'full' || value === 'none' ? value : 'minimal',
  normalizeBotReplyPlacementMode: (value: unknown) => (value === 'thread' ? 'thread' : 'agent'),
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
  extractGuestSettings: (settings: Record<string, unknown> | null | undefined) => {
    const rawPolicy = settings?.guestPolicy as string | undefined;
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
  // mirror the production helpers just well enough that
  // BotMessageRouter.registerHandlers can read a clean list of entries.
  // Tests can populate `settings.watchKeywords` with the canonical
  // `[{ keyword, instruction? }]` shape to exercise both the keyword-match
  // gate and the instruction-injection branch.
  extractWatchKeywordEntries: (
    settings: Record<string, unknown> | null | undefined,
  ): Array<{ asName?: boolean; instruction?: string; keyword: string }> => {
    const raw = settings?.watchKeywords;
    const byKeyword = new Map<
      string,
      { asName?: boolean; instruction?: string; keyword: string }
    >();
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry === 'string') {
          const k = entry.trim().toLowerCase();
          if (k && !byKeyword.has(k)) byKeyword.set(k, { keyword: k });
        } else if (entry && typeof entry === 'object' && 'keyword' in entry) {
          const obj = entry as { asName?: unknown; instruction?: unknown; keyword?: unknown };
          if (typeof obj.keyword !== 'string') continue;
          const k = obj.keyword.trim().toLowerCase();
          if (!k) continue;
          const instruction =
            typeof obj.instruction === 'string' && obj.instruction.trim()
              ? obj.instruction.trim()
              : undefined;
          const existing = byKeyword.get(k);
          if (!existing)
            byKeyword.set(k, {
              instruction,
              keyword: k,
              ...(obj.asName === true && { asName: true }),
            });
          else if (!existing.instruction && instruction) existing.instruction = instruction;
        }
      }
    }
    return Array.from(byKeyword.values());
  },
  findMatchingWatchKeywordEntries: (
    text: string | undefined | null,
    entries: ReadonlyArray<{ instruction?: string; keyword: string }>,
  ) => {
    if (!text || entries.length === 0) return [];
    const lowered = text.toLowerCase();
    const wordChar = /\w/;
    return entries.filter((entry) => {
      const idx = lowered.indexOf(entry.keyword);
      if (idx === -1) return false;
      const before = idx === 0 ? '' : lowered[idx - 1];
      const after =
        idx + entry.keyword.length >= lowered.length ? '' : lowered[idx + entry.keyword.length];
      const leftBoundary = !before || !wordChar.test(before);
      const rightBoundary = !after || !wordChar.test(after);
      return leftBoundary && rightBoundary;
    });
  },
  messageMatchesWatchKeyword: (
    text: string | undefined | null,
    keywords: ReadonlyArray<string>,
  ): boolean => {
    if (!text || keywords.length === 0) return false;
    const lowered = text.toLowerCase();
    const wordChar = /\w/;
    for (const keyword of keywords) {
      const idx = lowered.indexOf(keyword);
      if (idx === -1) continue;
      const before = idx === 0 ? '' : lowered[idx - 1];
      const after = idx + keyword.length >= lowered.length ? '' : lowered[idx + keyword.length];
      const leftBoundary = !before || !wordChar.test(before);
      const rightBoundary = !after || !wordChar.test(after);
      if (leftBoundary && rightBoundary) return true;
    }
    return false;
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
  shouldHandleGuest: (params: {
    authorUserId: string | undefined;
    guestSettings: { policy: 'allowlist' | 'disabled' | 'open' | 'pairing' };
    isGuest: boolean;
    operatorUserId?: string;
    userAllowlist: { ids: string[] };
  }): 'allow' | 'pair' | 'reject' => {
    if (!params.isGuest) return 'allow';
    if (params.guestSettings.policy === 'disabled') return 'reject';
    if (params.guestSettings.policy === 'open') return 'allow';
    if (!params.authorUserId) return 'reject';
    if (
      params.guestSettings.policy === 'pairing' &&
      params.operatorUserId &&
      params.authorUserId === params.operatorUserId
    ) {
      return 'allow';
    }
    const inList =
      params.userAllowlist.ids.length > 0 && params.userAllowlist.ids.includes(params.authorUserId);
    if (inList) return 'allow';
    return params.guestSettings.policy === 'pairing' ? 'pair' : 'reject';
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
});

// ==================== Helpers ====================

export const FAKE_DB = {} as any;
export const FAKE_GATEKEEPER = { decrypt: vi.fn() };

export function makeProvider(overrides: Record<string, any> = {}) {
  return {
    agentId: 'agent-1',
    applicationId: 'app-123',
    credentials: { botToken: 'token' },
    userId: 'user-1',
    ...overrides,
  };
}

/** Restore the per-test defaults that `vi.clearAllMocks` wipes. */
export function resetBotMessageRouterMocks() {
  vi.clearAllMocks();
  mockGetServerDB.mockResolvedValue(FAKE_DB);
  mockInitWithEnvKey.mockResolvedValue(FAKE_GATEKEEPER);
  mockFindEnabledByPlatform.mockResolvedValue([]);
  mockHandleMention.mockResolvedValue(undefined);
  mockHandleSubscribedMessage.mockResolvedValue(undefined);
  mockAgentBridgeServiceCtor.mockImplementation(function () {
    return {
      handleMention: mockHandleMention,
      handleSubscribedMessage: mockHandleSubscribedMessage,
    };
  });
  mockOpenThreadForChannelWake.mockResolvedValue(undefined);
  mockGetBotNames.mockResolvedValue([]);
  // participant tracking — restore defaults wiped by
  // clearAllMocks. Empty list = fresh single-human thread; individual
  // describes / tests override as needed.
  mockGetList.mockResolvedValue([]);
  mockAppendToList.mockResolvedValue(undefined);
  mockStateSetIfNotExists.mockResolvedValue(true);
  // Reset pairing-store + provider-model mocks to safe defaults so a
  // previous test's stub doesn't leak into the next one.
  mockPeekPairingRequest.mockResolvedValue(null);
  mockDeletePairingRequest.mockResolvedValue(undefined);
  mockReleasePairingClaim.mockResolvedValue(undefined);
  mockCreateOrGetPairingRequest.mockResolvedValue({ status: 'redis-unavailable' });
  mockProviderFindById.mockResolvedValue(undefined);
  mockProviderUpdate.mockResolvedValue(undefined);
  mockGetAgentRuntimeRedisClient.mockReturnValue(null);
  mockGetBotFeatureAccessState.mockResolvedValue({ allowed: true });
  mockChatWebhooks.telegram = mockWebhookHandler;
}
