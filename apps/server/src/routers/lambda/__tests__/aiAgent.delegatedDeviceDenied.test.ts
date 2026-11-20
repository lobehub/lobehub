// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { agents } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as InternalJwtModule from '@/libs/trpc/utils/internalJwt';

import { aiAgentRouter } from '../aiAgent';
import { cleanupTestUser, createTestUser } from './integration/setup';

// Mock getServerDB to return our test database instance
let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const mockStartComposerRun = vi.fn();
vi.mock('@/server/services/aiAgent/composerRun', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startComposerRun: (...args: any[]) => mockStartComposerRun(...args),
}));

// Mock AgentRuntimeService since we only want to test the router's business logic
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(function () {
    return {
      createOperation: vi.fn(async (params: any) => {
        // The real runtime invokes this before the run's first step, with the
        // operation it is about to start; mirror it so the router's Task-run
        // reopen path runs when a test seeds a Task run. It is a no-op for the
        // ordinary conversation, which attaches no hooks.
        await params?.onOperationCreated?.(params?.operationId);
        return {
          success: true,
          operationId: params?.operationId ?? 'mock-operation-id',
          autoStarted: true,
          messageId: 'mock-message-id',
        };
      }),
    };
  }),
}));

// Mock serverMessagesEngine
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn(function () {
    return {
      generateToolsDetailed: vi.fn(function () {
        return { tools: [] };
      }),
      getEnabledPluginManifests: vi.fn(function () {
        return new Map();
      }),
    };
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ],
    metadata: {},
  }),
}));

// Mock AiChatService to avoid S3 dependency
vi.mock('@/server/services/aiChat', () => ({
  AiChatService: vi.fn().mockImplementation(function () {
    return {
      getMessagesAndTopics: vi.fn().mockResolvedValue({ messages: [], topics: [] }),
    };
  }),
}));

// Mock FileService to avoid S3 dependency
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(function () {
    return {
      getFullFileUrl: vi.fn(function (path: string | null) {
        return path;
      }),
    };
  }),
}));

// Mock the resource-permission guard so workspace-mode tests can assert the
// router resolves slug → agent id and runs the `use` guard (the guard's own
// RBAC evaluation is covered by its service tests).
vi.mock('@/server/services/resourcePermission', () => ({
  assertCanPerformResourceAction: vi.fn(),
  getResourceMeta: vi.fn(),
}));

// The user-hub token is a real RS256 signature in production; the integration
// DB has no JWKS_KEY, so pin the signer and assert the subject it is asked for.
const mockSignUserJWT = vi.fn();
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => ({
  ...(await importOriginal<typeof InternalJwtModule>()),
  signUserJWT: (...args: any[]) => mockSignUserJWT(...args),
}));

// Mock model-bank with dynamic import to preserve other exports
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: { functionCall: true, vision: true, video: false },
      },
    ],
  };
});

/**
 * A sandbox token minted for a run whose sender may not use devices
 * (`device_access: 'denied'`) — e.g. an external bot sender's Claude Code
 * sandbox running `lh topic send --new`. What that run starts keeps the
 * denial instead of running first-party on the owner's device.
 */
describe('aiAgent router - run started from a device-denied run', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    const [agent] = await serverDB
      .insert(agents)
      .values({ model: 'gpt-4o-mini', provider: 'openai', title: 'Atlas', userId })
      .returning();
    agentId = agent.id;
    mockStartComposerRun.mockReset().mockResolvedValue({
      autoStarted: true,
      operationId: 'op-new',
      success: true,
      topicId: 'tpc-new',
    });
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
    vi.restoreAllMocks();
  });

  const callerWith = (oidcAuth?: Record<string, unknown>) =>
    aiAgentRouter.createCaller({ jwtPayload: { userId }, oidcAuth, userId } as any);

  it('refuses to name a device', async () => {
    await expect(
      callerWith({ device_access: 'denied', sub: userId }).execAgent({
        agentId,
        deviceId: 'dev-owner-mac',
        prompt: 'Run this on the Mac',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mockStartComposerRun).not.toHaveBeenCalled();
  }, 20_000);

  it('hands the denial to the run it starts', async () => {
    await callerWith({ device_access: 'denied', sub: userId }).execAgent({
      agentId,
      prompt: 'Open a sub-topic',
    });
    expect(mockStartComposerRun.mock.calls[0][1]).toMatchObject({
      delegatedDeviceAccessDenied: true,
    });

    await callerWith({ sub: userId }).execAgent({ agentId, prompt: 'A first-party send' });
    expect(mockStartComposerRun.mock.calls[1][1]).not.toHaveProperty('delegatedDeviceAccessDenied');
  }, 20_000);
});
