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
  const buildService = () => {
    const service = new ChatService({} as LobeChatDatabase, 'user-1');
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
