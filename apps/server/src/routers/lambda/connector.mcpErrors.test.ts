// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { createMCPError } from '@/libs/mcp/types';
import { callConnectorToolById, ConnectorToolCallError } from '@/server/services/connector/exec';
import { syncConnectorToolsById } from '@/server/services/connector/sync';

import { connectorRouter } from './connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/workspace', () => ({ WorkspaceModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: vi.fn() }));
vi.mock('@/server/services/connector/exec', () => ({
  callConnectorToolById: vi.fn(),
  ConnectorToolCallError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => trpc.middleware((opts) => opts.next()),
    wsCompatProcedure: trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    serverDatabase: trpc.middleware((opts) =>
      opts.next({ ctx: { ...opts.ctx, serverDB: {} as never } }),
    ),
  };
});

describe('connector MCP connect error propagation', () => {
  const id = '9f1f6f30-0000-4000-8000-000000000001';
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue({ id, userId: 'test-user' }) } as never;
    });
  });
  it.each([
    ['FORBIDDEN', 'AUTHORIZATION_ERROR'],
    ['TIMEOUT', 'INITIALIZATION_TIMEOUT'],
    ['SERVICE_UNAVAILABLE', 'CONNECTION_FAILED'],
  ] as const)('preserves %s from discovery on both connector operations', async (code, type) => {
    const error = new TRPCError({
      code,
      cause: createMCPError(type, 'MCP connection needs attention'),
      message: 'MCP connection needs attention',
    });
    vi.mocked(syncConnectorToolsById).mockRejectedValue(error);
    vi.mocked(callConnectorToolById).mockRejectedValue(error);
    const caller = connectorRouter.createCaller({ userId: 'test-user' } as never);
    await expect(caller.syncTools({ id })).rejects.toMatchObject({
      code,
      message: error.message,
    });
    await expect(caller.callTool({ identifier: 'mcp', toolName: 'echo' })).rejects.toMatchObject({
      code,
      message: error.message,
    });
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'] as const)(
    'keeps unrelated %s service errors on their existing path',
    async (code) => {
      const error = new TRPCError({ code, message: 'unrelated service failure' });
      vi.mocked(syncConnectorToolsById).mockRejectedValue(error);
      vi.mocked(callConnectorToolById).mockRejectedValue(error);
      const caller = connectorRouter.createCaller({ userId: 'test-user' } as never);
      // Canary preserves structured sync rejections (including desktop-only
      // stdio guidance); tool calls keep their separate wrapping policy.
      await expect(caller.syncTools({ id })).rejects.toBe(error);
      await expect(caller.callTool({ identifier: 'mcp', toolName: 'echo' })).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        cause: error,
      });
    },
  );

  it('retains connector access and validation errors', async () => {
    const error = new ConnectorToolCallError('BAD_REQUEST', 'Tool is disabled');
    vi.mocked(callConnectorToolById).mockRejectedValue(error);
    await expect(
      connectorRouter
        .createCaller({ userId: 'test-user' } as never)
        .callTool({ identifier: 'mcp', toolName: 'echo' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'Tool is disabled' });
  });
});
