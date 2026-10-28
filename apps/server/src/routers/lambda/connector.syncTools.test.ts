// @vitest-environment node
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import superjson from 'superjson';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';

import { connectorRouter } from './connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
const workspaceMocks = vi.hoisted(() => ({
  getConnectorMemberManage: vi.fn(async () => 'all_members' as const),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return workspaceMocks;
  }),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
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

const sync = vi.hoisted(() => vi.fn());
vi.mock('@/server/services/connector/sync', () => ({ syncConnectorToolsById: sync }));

const id = '9f1f6f30-0000-4000-8000-000000000001';

describe('connectorRouter.syncTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return { findById: vi.fn().mockResolvedValue({ id, userId: 'creator' }) } as never;
    });
  });

  const caller = () => connectorRouter.createCaller({ userId: 'creator' } as never);

  it('preserves a typed rejection and its structured reason for the client', async () => {
    sync.mockRejectedValue(
      new TRPCError({
        cause: { data: { code: 'StdioDesktopOnly' } },
        code: 'BAD_REQUEST',
        message: 'Stdio MCP type is not supported in web environment.',
      }),
    );
    await expect(caller().syncTools({ id })).rejects.toMatchObject({
      cause: { data: { code: 'StdioDesktopOnly' } },
      code: 'BAD_REQUEST',
    });
  });

  it('serializes the reason into data.errorData over the real tRPC transport', async () => {
    sync.mockRejectedValue(
      new TRPCError({
        cause: { data: { code: 'StdioDesktopOnly' } },
        code: 'BAD_REQUEST',
        message: 'Stdio MCP type is not supported in web environment.',
      }),
    );
    const client = createTRPCClient<typeof connectorRouter>({
      links: [
        httpLink({
          url: 'http://localhost/trpc',
          transformer: superjson,
          fetch: (url, options) =>
            fetchRequestHandler({
              createContext: async () => ({ userId: 'creator' }) as never,
              endpoint: '/trpc',
              req: new Request(url, options),
              router: connectorRouter,
            }),
        }),
      ],
    });

    const error = await client.syncTools.mutate({ id }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TRPCClientError);
    expect(error).toMatchObject({
      data: {
        code: 'BAD_REQUEST',
        errorData: { code: 'StdioDesktopOnly' },
        httpStatus: 400,
      },
    });
  });

  it('still wraps unexpected upstream failures', async () => {
    sync.mockRejectedValue(new Error('connection reset'));
    await expect(caller().syncTools({ id })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch tools from MCP server: connection reset',
    });
  });
});
