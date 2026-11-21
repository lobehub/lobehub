// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';

import { connectorRouter } from '../connector';

/**
 * Which device a workspace connector may be bound to follows who runs it, the
 * same split as connector loading: a shared connector only a public device of
 * the workspace, a private one also its creator's own private device.
 */

const mocks = vi.hoisted(() => ({
  findWorkspaceDeviceById: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/database/models/connectorTool', () => ({ ConnectorToolModel: vi.fn() }));
vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/device', () => ({
  DeviceModel: vi.fn(function () {
    return { findWorkspaceDeviceById: mocks.findWorkspaceDeviceById };
  }),
}));
vi.mock('@/database/models/workspace', () => ({
  WorkspaceModel: vi.fn(function () {
    return { getConnectorMemberManage: async () => 'all_members' };
  }),
}));
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

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000004';
const member = () =>
  connectorRouter.createCaller({
    serverDB: {},
    userId: 'me',
    workspaceId: 'ws-1',
    workspaceRole: 'member',
  } as any);

const myPrivateDevice = { deviceId: 'my-laptop', userId: 'me', visibility: 'private' };
const sharedDevice = { deviceId: 'office-nas', userId: 'enroller', visibility: 'public' };
const devices = new Map([myPrivateDevice, sharedDevice].map((d) => [d.deviceId, d]));

const stdioInput = {
  identifier: 'my-mcp',
  mcpConnectionType: 'stdio' as const,
  mcpStdioConfig: { command: 'my-mcp' },
  name: 'My MCP',
  sourceType: 'custom' as const,
};

describe('connectorRouter device binding by visibility', () => {
  let connectorModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspaceDeviceById.mockImplementation(async (id: string) => devices.get(id));
    connectorModelMock = {
      create: vi.fn().mockResolvedValue({ id: 'created' }),
      changeVisibilityUnlessHeld: vi.fn().mockResolvedValue({ changed: true }),
      createUnlessIdentifierHeld: vi.fn().mockResolvedValue({ created: { id: 'created' } }),
      findById: vi.fn(),
      findScopedByIdentifier: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    };
    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(AgentModel).mockImplementation(function () {
      return {} as any;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return { queryByConnector: vi.fn().mockResolvedValue([]) } as any;
    });
  });

  describe('create', () => {
    it("binds a private connector to the creator's own private device", async () => {
      await expect(
        member().create({
          ...stdioInput,
          metadata: { boundDeviceId: 'my-laptop' },
          visibility: 'private',
        }),
      ).resolves.toEqual({ id: 'created', isNew: true });
      expect(connectorModelMock.createUnlessIdentifierHeld).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ boundDeviceId: 'my-laptop' }),
          visibility: 'private',
        }),
      );
    });

    it('binds a private connector to a shared device of the workspace', async () => {
      await expect(
        member().create({
          ...stdioInput,
          metadata: { boundDeviceId: 'office-nas' },
          visibility: 'private',
        }),
      ).resolves.toEqual({ id: 'created', isNew: true });
    });

    it('refuses a shared connector a private device', async () => {
      await expect(
        member().create({ ...stdioInput, metadata: { boundDeviceId: 'my-laptop' } }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(connectorModelMock.createUnlessIdentifierHeld).not.toHaveBeenCalled();
    });

    it('binds a shared connector to a shared device', async () => {
      await expect(
        member().create({ ...stdioInput, metadata: { boundDeviceId: 'office-nas' } }),
      ).resolves.toEqual({ id: 'created', isNew: true });
    });
  });

  describe('update', () => {
    const privateRow = (boundDeviceId?: string) => ({
      agentId: null,
      id: CONNECTOR_ID,
      identifier: 'my-mcp',
      mcpConnectionType: 'stdio',
      metadata: boundDeviceId ? { boundDeviceId } : {},
      userId: 'me',
      visibility: 'private',
    });

    it("rebinds a private connector to the creator's own private device", async () => {
      connectorModelMock.findById.mockResolvedValue(privateRow());

      await member().update({
        id: CONNECTOR_ID,
        patch: { metadata: { boundDeviceId: 'my-laptop' } },
      });

      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({ metadata: { boundDeviceId: 'my-laptop' } }),
      );
    });

    // Sharing hands the binding to every member's runs, which can't reach it
    it('refuses to share a private connector still bound to a private device', async () => {
      connectorModelMock.findById.mockResolvedValue(privateRow('my-laptop'));

      await expect(
        member().update({ id: CONNECTOR_ID, patch: { visibility: 'public' } }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(connectorModelMock.update).not.toHaveBeenCalled();
    });

    it('shares a private connector bound to a shared device', async () => {
      connectorModelMock.findById.mockResolvedValue(privateRow('office-nas'));

      await member().update({ id: CONNECTOR_ID, patch: { visibility: 'public' } });

      // The share claims the shared slot under the identifier lock
      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.any(String),
        'public',
      );
    });

    it('shares a private connector the same write moves to automatic routing', async () => {
      connectorModelMock.findById.mockResolvedValue(privateRow('my-laptop'));

      await member().update({ id: CONNECTOR_ID, patch: { metadata: {}, visibility: 'public' } });

      expect(connectorModelMock.changeVisibilityUnlessHeld).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.any(String),
        'public',
      );
      expect(connectorModelMock.update).toHaveBeenCalledWith(
        CONNECTOR_ID,
        expect.objectContaining({ metadata: {} }),
      );
    });
  });
});
