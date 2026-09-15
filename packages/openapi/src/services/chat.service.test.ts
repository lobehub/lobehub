// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { ChatService } from './chat.service';

const { chatMock, initModelRuntimeWithUserPayloadMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  initModelRuntimeWithUserPayloadMock: vi.fn(),
}));

vi.mock('@/const/rbac', () => ({ ALL_SCOPE: 'all' }));
vi.mock('@lobechat/database', () => ({
  buildWorkspacePayload: vi.fn(),
  buildWorkspaceWhere: vi.fn(),
}));
vi.mock('@/database/models/rbac', () => ({
  RbacModel: class {
    hasAnyPermission = vi.fn().mockResolvedValue(true);
  },
}));
vi.mock('@/database/models/user', () => ({ UserModel: class {} }));
vi.mock('@/database/schemas', () => ({
  agents: {},
  agentsToSessions: {},
  aiModels: {},
  aiProviders: {},
  files: {},
  knowledgeBases: {},
  messages: {},
  sessions: {},
  topics: {},
}));
vi.mock('@/utils/rbac', () => ({ getScopePermissions: () => [] }));
// Values a caller could not have supplied by accident, so the assertions below
// prove the service reads these constants rather than literals of its own.
//
// Mocked on `@lobechat/business-const`, which is where they are declared —
// mocking them onto `@/const/settings` instead made these tests pass while the
// build failed on `Export DEFAULT_PROVIDER doesn't exist in target module`:
// that barrel re-exports `DEFAULT_MODEL` only, and a factory mock happily
// invents any key asked of it.
const DEFAULT_MODEL = 'default-model-from-const';
const DEFAULT_PROVIDER = 'default-provider-from-const';

vi.mock('@lobechat/business-const', () => ({
  DEFAULT_MODEL: 'default-model-from-const',
  DEFAULT_PROVIDER: 'default-provider-from-const',
}));
vi.mock('@/const/settings', () => ({
  DEFAULT_AGENT_CHAT_CONFIG: {},
  DEFAULT_SYSTEM_AGENT_CONFIG: {},
}));
vi.mock('@lobechat/model-runtime', () => ({ mergeModelRuntimeHooks: vi.fn() }));
vi.mock('@lobechat/types', () => ({ RequestTrigger: { Api: 'api' } }));
vi.mock('@/business/server/model-runtime', () => ({ getBusinessModelRuntimeHooks: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn() },
}));
vi.mock('@/server/services/llmGenerationTracing/hook', () => ({
  createLLMGenerationTracingHook: vi.fn(),
}));
vi.mock('@/server/services/systemAgent/modelConfig', () => ({
  resolveSystemAgentModelConfig: vi.fn(),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeWithUserPayload: initModelRuntimeWithUserPayloadMock,
}));

describe('ChatService payload construction', () => {
  const buildService = (workspaceId?: string) => {
    const service = new ChatService({} as LobeChatDatabase, 'user-1', workspaceId);
    // Bypass permission + credential resolution; only the payload is under test.
    (service as any).resolveOperationPermission = vi.fn().mockResolvedValue({ isPermitted: true });
    (service as any).getApiKey = vi.fn().mockResolvedValue(JSON.stringify({ apiKey: 'k' }));
    (service as any).config = { defaultModel: 'm', defaultProvider: 'p' };
    return service;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chatMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    initModelRuntimeWithUserPayloadMock.mockResolvedValue({ chat: chatMock });
  });

  const messages = [{ content: 'hi', role: 'user' as const }];

  // The schema accepts `temperature: 0`; a `||` fallback would silently promote a
  // deterministic request to temperature 1.
  it('preserves an explicit temperature of 0', async () => {
    await buildService().chat({ messages, temperature: 0 } as any);

    expect(chatMock.mock.calls[0][0]).toMatchObject({ temperature: 0 });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('defaults temperature to 1 when %s', async (_label, temperature) => {
    await buildService().chat({ messages, temperature } as any);

    expect(chatMock.mock.calls[0][0]).toMatchObject({ temperature: 1 });
  });

  it('passes a non-zero temperature through unchanged', async () => {
    await buildService().chat({ messages, temperature: 0.7 } as any);

    expect(chatMock.mock.calls[0][0]).toMatchObject({ temperature: 0.7 });
  });

  it('passes workspace context to the runtime constructor', async () => {
    await buildService('workspace-1').chat({ messages } as any);

    expect(initModelRuntimeWithUserPayloadMock).toHaveBeenCalledWith(
      'p',
      { apiKey: 'k', userId: 'user-1' },
      { workspaceId: 'workspace-1' },
      undefined,
    );
  });
});

/**
 * A provider row whose `keyVaults` is null is the ordinary shape for a
 * deployment that supplies credentials through the environment: the row exists
 * so the provider can be enabled, and no per-user vault is ever written.
 *
 * `decrypt` splits its argument on `:` in its first statement, so handing that
 * null straight to it — which a `!` assertion used to allow — threw
 * `Cannot read properties of null (reading 'split')` out of every
 * `/api/v1/chat*` call, from inside a helper whose name gives no hint that a
 * credential lookup is what failed.
 */
/**
 * A request that names no model used to ask for `gpt-3.5-turbo` on `openai`,
 * hard-coded here and unreachable by any caller — `ChatServiceConfig` only
 * arrives through the constructor and the controller never passes one. On a
 * deployment that does not run OpenAI, that surfaced as a credential error
 * naming a provider the caller had never mentioned.
 */
describe('ChatService default model', () => {
  // `chatMock` accumulates across describes; without this the assertions below
  // read the first call of the whole file, which belongs to another test.
  beforeEach(() => vi.clearAllMocks());

  it('falls back to the product defaults, not to this service’s own literals', async () => {
    const service = new ChatService({} as LobeChatDatabase, 'user-1');
    (service as any).resolveOperationPermission = vi.fn().mockResolvedValue({ isPermitted: true });
    (service as any).getApiKey = vi.fn().mockResolvedValue(JSON.stringify({ apiKey: 'k' }));

    chatMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    initModelRuntimeWithUserPayloadMock.mockResolvedValue({ chat: chatMock });

    const result = await service.chat({ messages: [{ content: 'hi', role: 'user' }] } as any);

    expect(chatMock.mock.calls[0][0]).toMatchObject({ model: DEFAULT_MODEL });
    expect(initModelRuntimeWithUserPayloadMock.mock.calls[0][0]).toBe(DEFAULT_PROVIDER);
    expect(result).toMatchObject({ model: DEFAULT_MODEL, provider: DEFAULT_PROVIDER });
  });
});

describe('ChatService.getApiKey provider credentials', () => {
  const decrypt = vi.fn();

  const serviceWith = (rows: unknown[]) => {
    const service = new ChatService(
      { query: { aiProviders: { findMany: vi.fn().mockResolvedValue(rows) } } } as any,
      'user-1',
    );
    (service as any).buildWorkspaceWhere = vi.fn();
    return service;
  };

  const apiKey = (service: ChatService) => (service as any).getApiKey('openai');

  beforeEach(async () => {
    vi.clearAllMocks();
    decrypt.mockResolvedValue({ plaintext: '{"apiKey":"from-vault"}' });
    const { KeyVaultsGateKeeper } = await import('@/server/modules/KeyVaultsEncrypt');
    (KeyVaultsGateKeeper.initWithEnvKey as any).mockResolvedValue({ decrypt });
  });

  it('falls back to an empty vault when the row stores no key', async () => {
    await expect(apiKey(serviceWith([{ id: 'openai', keyVaults: null }]))).resolves.toBe('{}');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('falls back to an empty vault when no row exists', async () => {
    await expect(apiKey(serviceWith([]))).resolves.toBe('{}');
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('still decrypts a row that does store a key', async () => {
    await expect(apiKey(serviceWith([{ id: 'openai', keyVaults: 'iv:tag:data' }]))).resolves.toBe(
      '{"apiKey":"from-vault"}',
    );
    expect(decrypt).toHaveBeenCalledWith('iv:tag:data');
  });
});
