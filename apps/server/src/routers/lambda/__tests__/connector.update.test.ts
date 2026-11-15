// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';

import { connectorRouter } from '../connector';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware((opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000003';

describe('connectorRouter.update', () => {
  let connectorModelMock: { findById: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  const update = (patch: Record<string, unknown>) =>
    connectorRouter
      .createCaller({ serverDB: {}, userId: 'me' } as any)
      .update({ id: CONNECTOR_ID, patch });

  beforeEach(() => {
    vi.clearAllMocks();
    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({ id: CONNECTOR_ID, metadata: {}, userId: 'me' }),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock as any;
    });
  });

  // A client undoes a failed OAuth edit only when it can tell a callback that
  // connected the row from a canceled popup: only that callback reconnects it
  it('leaves the row disconnected until a new OAuth client is authorized', async () => {
    await update({ mcpServerUrl: 'https://new.example.com', oidcConfig: { scheme: 'dcr' } });

    expect(connectorModelMock.update).toHaveBeenCalledWith(
      CONNECTOR_ID,
      expect.objectContaining({ oidcConfig: { scheme: 'dcr' }, status: 'disconnected' }),
    );
  });

  it('drops an OAuth client without touching the status', async () => {
    await update({ oidcConfig: null });

    const [, stored] = connectorModelMock.update.mock.calls[0];
    expect(stored).toMatchObject({ oidcConfig: null });
    expect(stored).not.toHaveProperty('status');
  });

  // Undoing a failed custom install over a legacy marketplace projection: the
  // install's `create` made the row `custom`, the rollback makes it marketplace
  it('puts a row back on the install source it came from', async () => {
    await update({ mcpConnectionType: null, mcpServerUrl: null, sourceType: 'marketplace' });

    expect(connectorModelMock.update).toHaveBeenCalledWith(
      CONNECTOR_ID,
      expect.objectContaining({ mcpServerUrl: null, sourceType: 'marketplace' }),
    );
  });

  it('refuses to turn a row into a builtin tool', async () => {
    await expect(update({ sourceType: 'builtin' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(connectorModelMock.update).not.toHaveBeenCalled();
  });

  it('keeps the status of an edit that brings no OAuth client', async () => {
    await update({ name: 'Renamed' });

    expect(connectorModelMock.update.mock.calls[0][1]).not.toHaveProperty('status');
  });
});
