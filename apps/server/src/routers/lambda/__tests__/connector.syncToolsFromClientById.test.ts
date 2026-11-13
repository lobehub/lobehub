// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { ConnectorStatus } from '@/database/schemas';

import { connectorRouter } from '../connector';

// `vi.mock` is hoisted by vitest's transformer above all imports at runtime,
// so the relative import order doesn't matter functionally — the mocks below
// are still active when the router module is evaluated. They live below the
// imports to satisfy `import-x/first` without disabling the rule.
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
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  // The real `wsCompatProcedure` validates a Better-Auth session; for unit
  // tests we skip auth and rely on the test ctx already carrying `userId`.
  return {
    requireWorkspaceRoleWhenScoped: () => mod.trpc.middleware(async (opts: any) => opts.next()),
    wsCompatProcedure: mod.trpc.procedure,
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

const CONNECTOR_ID = '9f1f6f30-0000-4000-8000-000000000001';

// The desktop-reported install path for MCP servers the cloud can't reach
// (stdio / localhost / LAN endpoints, #16533): the client lists the tools
// locally and reports them into an existing connector row.
describe('connectorRouter.syncToolsFromClientById', () => {
  let connectorModelMock: any;
  let connectorToolModelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('all_members');

    connectorModelMock = {
      findById: vi.fn().mockResolvedValue({
        id: CONNECTOR_ID,
        identifier: 'my-local-mcp',
        userId: 'user_test',
      }),
      updateStatus: vi.fn(),
    };
    connectorToolModelMock = { upsertMany: vi.fn() };

    vi.mocked(ConnectorModel).mockImplementation(function () {
      return connectorModelMock;
    });
    vi.mocked(ConnectorToolModel).mockImplementation(function () {
      return connectorToolModelMock;
    });
  });

  const caller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
    } as any);

  it('upserts the reported tools and promotes the connector to connected', async () => {
    const res = await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        { description: 'list things', inputSchema: { type: 'object' }, toolName: 'list_things' },
        { toolName: 'delete_thing' },
      ],
    });

    expect(res).toEqual({ toolCount: 2 });
    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ crudType: 'read', toolName: 'list_things' }),
      expect.objectContaining({ crudType: 'delete', toolName: 'delete_thing' }),
    ]);
    expect(connectorModelMock.updateStatus).toHaveBeenCalledWith(
      CONNECTOR_ID,
      ConnectorStatus.connected,
    );
  });

  it('keeps the MCP Apps visibility the desktop reported for each tool', async () => {
    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [{ toolName: 'show_dashboard' }, { toolName: 'load_page', visibility: ['app'] }],
    });

    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ metadata: null, toolName: 'show_dashboard' }),
      expect.objectContaining({ metadata: { visibility: ['app'] }, toolName: 'load_page' }),
    ]);
  });

  it('makes a new tool need approval when its manifest requires intervention', async () => {
    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        { humanIntervention: 'required', toolName: 'send_mail' },
        { humanIntervention: 'always', toolName: 'delete_file' },
        { humanIntervention: 'never', toolName: 'list_files' },
        { toolName: 'read_file' },
      ],
    });

    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'send_mail' }),
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'delete_file' }),
      expect.objectContaining({ defaultPermission: 'auto', toolName: 'list_files' }),
      expect.objectContaining({ defaultPermission: 'auto', toolName: 'read_file' }),
    ]);
  });

  // The connector manifest carries one permission per tool, so a rule list that
  // asks for approval for some arguments must not land as `auto`
  it('makes a new tool need approval when any of its intervention rules requires it', async () => {
    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        {
          humanIntervention: [
            { match: { path: '/tmp/*' }, policy: 'never' },
            { match: { recursive: 'true' }, policy: 'always' },
          ],
          toolName: 'remove_path',
        },
        {
          humanIntervention: [
            { match: { mode: 'draft' }, policy: 'never' },
            { policy: 'required' },
          ],
          toolName: 'publish_post',
        },
        { humanIntervention: [{ policy: 'never' }], toolName: 'list_posts' },
      ],
    });

    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'remove_path' }),
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'publish_post' }),
      expect.objectContaining({ defaultPermission: 'auto', toolName: 'list_posts' }),
    ]);
  });

  // A dynamic resolver does not run on a connector: either of its outcomes counts
  it('makes a new tool need approval when its dynamic config can require it', async () => {
    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        { humanIntervention: { dynamic: { default: 'always', type: 'x' } }, toolName: 'a' },
        { humanIntervention: { dynamic: { default: 'never', type: 'x' } }, toolName: 'b' },
        {
          humanIntervention: { dynamic: { default: 'never', policy: 'required', type: 'x' } },
          toolName: 'c',
        },
        {
          humanIntervention: { dynamic: { default: 'never', policy: 'never', type: 'x' } },
          toolName: 'd',
        },
      ],
    });

    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'a' }),
      // An unset `policy` is `always` when the resolver matches
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'b' }),
      expect.objectContaining({ defaultPermission: 'needs_approval', toolName: 'c' }),
      expect.objectContaining({ defaultPermission: 'auto', toolName: 'd' }),
    ]);
  });

  // The connector manifest maps `needs_approval` to `required`, which auto-run
  // and headless skip; a manifest's `always` must survive as its own mark
  it('marks a tool whose manifest can ask for always approval, on every sync', async () => {
    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      tools: [
        { humanIntervention: 'always', toolName: 'delete_file' },
        { humanIntervention: 'always', toolName: 'wipe', visibility: ['model'] },
        {
          humanIntervention: [
            { match: { path: '/tmp/*' }, policy: 'never' },
            { match: { recursive: 'true' }, policy: 'always' },
          ],
          toolName: 'remove_path',
        },
        { humanIntervention: { dynamic: { default: 'never', type: 'x' } }, toolName: 'audited' },
        { humanIntervention: 'required', toolName: 'send_mail' },
        {
          humanIntervention: { dynamic: { default: 'never', policy: 'required', type: 'x' } },
          toolName: 'publish',
        },
        { toolName: 'read_file', visibility: ['app'] },
      ],
    });

    expect(connectorToolModelMock.upsertMany).toHaveBeenCalledWith(CONNECTOR_ID, [
      expect.objectContaining({ metadata: { mandatoryApproval: true }, toolName: 'delete_file' }),
      expect.objectContaining({
        metadata: { mandatoryApproval: true, visibility: ['model'] },
        toolName: 'wipe',
      }),
      expect.objectContaining({ metadata: { mandatoryApproval: true }, toolName: 'remove_path' }),
      expect.objectContaining({ metadata: { mandatoryApproval: true }, toolName: 'audited' }),
      expect.objectContaining({ metadata: null, toolName: 'send_mail' }),
      expect.objectContaining({ metadata: null, toolName: 'publish' }),
      expect.objectContaining({ metadata: { visibility: ['app'] }, toolName: 'read_file' }),
    ]);
  });

  it('drops the auto tools an install no longer lists, keeping permission tombstones', async () => {
    connectorToolModelMock.queryByConnector = vi.fn().mockResolvedValue([
      { permission: 'auto', toolName: 'kept' },
      { permission: 'auto', toolName: 'removed_auto' },
      { permission: 'needs_approval', toolName: 'removed_gated' },
      { permission: 'disabled', toolName: 'removed_disabled' },
    ]);
    connectorToolModelMock.deleteToolsNotIn = vi.fn();

    await caller().syncToolsFromClientById({
      id: CONNECTOR_ID,
      pruneMissingAutoTools: true,
      tools: [{ toolName: 'kept' }],
    });

    expect(connectorToolModelMock.deleteToolsNotIn).toHaveBeenCalledWith(CONNECTOR_ID, [
      'kept',
      'removed_gated',
      'removed_disabled',
    ]);
  });

  it('leaves the stored tools alone without an install', async () => {
    connectorToolModelMock.deleteToolsNotIn = vi.fn();

    await caller().syncToolsFromClientById({ id: CONNECTOR_ID, tools: [{ toolName: 'kept' }] });

    expect(connectorToolModelMock.deleteToolsNotIn).not.toHaveBeenCalled();
  });

  it('rejects an unknown connector id', async () => {
    connectorModelMock.findById.mockResolvedValue(undefined);

    await expect(
      caller().syncToolsFromClientById({ id: CONNECTOR_ID, tools: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(connectorToolModelMock.upsertMany).not.toHaveBeenCalled();
  });

  const memberCaller = () =>
    connectorRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: 'ws_1',
      workspaceRole: 'member',
    } as any);

  it("lets a member co-maintain another member's workspace connector by default", async () => {
    connectorModelMock.findById.mockResolvedValue({
      id: CONNECTOR_ID,
      identifier: 'my-local-mcp',
      userId: 'someone_else',
    });

    await memberCaller().syncToolsFromClientById({ id: CONNECTOR_ID, tools: [] });

    expect(connectorModelMock.updateStatus).toHaveBeenCalled();
  });

  it('rejects a member when admins restricted connector management', async () => {
    workspaceMocks.getConnectorMemberManage.mockResolvedValue('admins_only');
    connectorModelMock.findById.mockResolvedValue({
      id: CONNECTOR_ID,
      identifier: 'my-local-mcp',
      userId: 'user_test',
    });

    await expect(
      memberCaller().syncToolsFromClientById({ id: CONNECTOR_ID, tools: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(connectorToolModelMock.upsertMany).not.toHaveBeenCalled();
    expect(connectorModelMock.updateStatus).not.toHaveBeenCalled();
  });
});
