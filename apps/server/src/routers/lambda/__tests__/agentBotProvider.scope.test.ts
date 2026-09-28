// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// serverDatabase middleware calls getServerDB(); the model is mocked, so the
// handle it returns is never dereferenced.
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/business/server/trpc-middlewares/rbacPermission', () => ({
  withScopedPermission: vi.fn(function () {
    return (opts: any) => opts.next({ ctx: opts.ctx });
  }),
}));

vi.mock('@/business/server/bot/featureAccess', () => ({
  assertBotFeatureAccess: vi.fn(async () => {}),
  withBotPlatformAccessMeta: vi.fn((meta: any) => meta),
}));

vi.mock('@/server/services/bot/agentBotProviderSettings', () => ({
  assertBotAccessSettings: vi.fn(),
  assertWatchKeywordsWritable: vi.fn(async () => {}),
  invalidateBotAfterUpdate: vi.fn(async () => {}),
  mergeBotSettingsForPersist: vi.fn((_platform: string, settings: unknown) => settings ?? {}),
}));

vi.mock('@/server/services/bot/platforms', () => ({
  collectFieldFormatViolations: vi.fn(() => []),
  formatFieldFormatViolations: vi.fn(() => ''),
  mergeWithDefaults: vi.fn((_p: string, s: unknown) => s),
  // Shaped like the real feishu entry so the masking helper can tell the
  // secret apart from the identifier.
  platformRegistry: {
    getPlatform: vi.fn(() => ({
      schema: [
        {
          key: 'credentials',
          properties: [
            { key: 'appSecret', type: 'password' },
            { key: 'appId', type: 'string' },
          ],
          type: 'object',
        },
      ],
    })),
  },
  withResolvedConcurrencySettings: vi.fn((_p: string, s: unknown) => s),
}));

const mockStopClient = vi.fn(async () => {});
vi.mock('@/server/services/gateway', () => ({
  GatewayService: vi.fn(function () {
    return { stopClient: mockStopClient };
  }),
}));

const mockInvalidateBot = vi.fn(async () => {});
vi.mock('@/server/services/bot/BotMessageRouter', () => ({
  getBotMessageRouter: vi.fn(() => ({ invalidateBot: mockInvalidateBot })),
}));

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  getBotRuntimeStatus: vi.fn(async () => ({ status: 'disconnected' })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));

const mockGetMember = vi.fn();
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { getMember: mockGetMember };
  }),
}));

const mockCreate = vi.fn();
const mockQuery = vi.fn();
const mockFindByAgentId = vi.fn();
const mockUpdate = vi.fn();
const mockFindById = vi.fn();
const mockDelete = vi.fn();
const mockFindByIdAcrossScopes = vi.fn();
const mockDeleteAcrossScopes = vi.fn();
const mockFindByPlatformAndAppId = vi.fn();

vi.mock('@/database/models/agentBotProvider', () => {
  const AgentBotProviderModel: any = vi.fn(function () {
    return {
      create: mockCreate,
      delete: mockDelete,
      deleteAcrossScopes: mockDeleteAcrossScopes,
      findByAgentId: mockFindByAgentId,
      findById: mockFindById,
      findByIdAcrossScopes: mockFindByIdAcrossScopes,
      query: mockQuery,
      update: mockUpdate,
    };
  });
  AgentBotProviderModel.findByPlatformAndAppId = mockFindByPlatformAndAppId;
  return { AgentBotProviderModel };
});

const { agentBotProviderRouter } = await import('../agentBotProvider');
const { CREDENTIAL_MASK } = await import('@/server/services/bot/credentialMasking');

/** Shaped like the driver error drizzle surfaces, nested behind `cause`. */
const uniqueViolation = () => {
  const error = new Error('duplicate key value violates unique constraint');
  (error as any).cause = { code: '23505' };
  return error;
};

const BOT_ID = 'bot-1';
const ctx: any = { serverDB: {}, userId: 'user-1', workspaceId: 'ws-1', workspaceRole: 'owner' };

const strandedRow = {
  agentId: 'agt_other',
  applicationId: 'cli_app',
  id: BOT_ID,
  platform: 'feishu',
  userId: 'user-1',
  workspaceId: null,
};

/** Same row, but parked in a workspace instead of personal scope. */
const strandedInWorkspace = { ...strandedRow, workspaceId: 'ws-other' };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindById.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue([]);
  mockFindByIdAcrossScopes.mockResolvedValue(undefined);
  mockDeleteAcrossScopes.mockResolvedValue([{ id: BOT_ID }]);
  mockGetMember.mockResolvedValue({ role: 'member' });
  mockQuery.mockResolvedValue([]);
  mockFindByAgentId.mockResolvedValue([]);
  mockUpdate.mockResolvedValue([]);
});

describe('agentBotProviderRouter · bindings stranded outside the active scope', () => {
  describe('delete', () => {
    it('reclaims the caller’s own binding when the active scope cannot see it', async () => {
      // The row lives in personal scope while the session is in a workspace.
      // `list` hides it and the scoped delete misses it, yet it still holds the
      // global (platform, applicationId) key that blocks every re-bind.
      mockFindByIdAcrossScopes.mockResolvedValue(strandedRow);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).resolves.toEqual([{ id: BOT_ID }]);

      expect(mockDeleteAcrossScopes).toHaveBeenCalledWith(BOT_ID);
      // The gateway still has to be told, using the stranded row's identifiers.
      expect(mockStopClient).toHaveBeenCalledWith('feishu', 'cli_app', 'user-1');
      expect(mockInvalidateBot).toHaveBeenCalledWith('feishu', 'cli_app');
    });

    it('refuses instead of reporting success when nothing was removed', async () => {
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockDeleteAcrossScopes).not.toHaveBeenCalled();
    });

    it('will not let one user delete another user’s binding', async () => {
      mockFindByIdAcrossScopes.mockResolvedValue({ ...strandedRow, userId: 'someone-else' });
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(mockDeleteAcrossScopes).not.toHaveBeenCalled();
    });

    it('does not consult workspace membership for a personal binding', async () => {
      mockFindByIdAcrossScopes.mockResolvedValue(strandedRow);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).resolves.toEqual([{ id: BOT_ID }]);
      expect(mockGetMember).not.toHaveBeenCalled();
    });

    it('reclaims a workspace binding while the creator still has a seat there', async () => {
      mockFindByIdAcrossScopes.mockResolvedValue(strandedInWorkspace);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).resolves.toEqual([{ id: BOT_ID }]);
      expect(mockGetMember).toHaveBeenCalledWith('ws-other', 'user-1');
    });

    it('refuses once the creator has left the workspace holding the binding', async () => {
      // Creating it once is not standing access: the procedure's agent:update
      // gate only covers the active scope, so a departed member could otherwise
      // kill an integration the workspace still runs.
      mockFindByIdAcrossScopes.mockResolvedValue(strandedInWorkspace);
      mockGetMember.mockResolvedValue(undefined);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockDeleteAcrossScopes).not.toHaveBeenCalled();
      expect(mockStopClient).not.toHaveBeenCalled();
    });

    it('refuses a creator demoted to viewer in the workspace holding the binding', async () => {
      mockFindByIdAcrossScopes.mockResolvedValue(strandedInWorkspace);
      mockGetMember.mockResolvedValue({ role: 'viewer' });
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockDeleteAcrossScopes).not.toHaveBeenCalled();
    });

    it('leaves the ordinary in-scope delete alone', async () => {
      mockFindById.mockResolvedValue(strandedRow);
      mockDelete.mockResolvedValue([{ id: BOT_ID }]);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.delete({ id: BOT_ID })).resolves.toEqual([{ id: BOT_ID }]);
      expect(mockFindByIdAcrossScopes).not.toHaveBeenCalled();
      expect(mockDeleteAcrossScopes).not.toHaveBeenCalled();
    });
  });

  describe('create conflict message', () => {
    const input = {
      agentId: 'agt_target',
      applicationId: 'cli_app',
      credentials: { appSecret: 's' },
      platform: 'feishu',
    };

    it('names the caller’s own holder and where it lives', async () => {
      mockCreate.mockRejectedValue(uniqueViolation());
      mockFindByPlatformAndAppId.mockResolvedValue(strandedRow);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.create(input)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('agt_other'),
      });
      await expect(caller.create(input)).rejects.toMatchObject({
        message: expect.stringContaining('personal'),
      });
    });

    it('does not name another account’s agent or workspace', async () => {
      mockCreate.mockRejectedValue(uniqueViolation());
      mockFindByPlatformAndAppId.mockResolvedValue({
        ...strandedRow,
        userId: 'someone-else',
        workspaceId: 'ws-secret',
      });
      const caller = agentBotProviderRouter.createCaller(ctx);

      const error = await caller.create(input).catch((e) => e);

      expect(error.code).toBe('CONFLICT');
      expect(error.message).toContain('another account');
      expect(error.message).not.toContain('agt_other');
      expect(error.message).not.toContain('ws-secret');
    });

    it('tells the caller to retry when the holder is already gone', async () => {
      mockCreate.mockRejectedValue(uniqueViolation());
      mockFindByPlatformAndAppId.mockResolvedValue(undefined);
      const caller = agentBotProviderRouter.createCaller(ctx);

      await expect(caller.create(input)).rejects.toMatchObject({
        message: expect.stringContaining('Retry'),
      });
    });
  });
});

describe('agentBotProviderRouter · credentials never leave through a list', () => {
  const row = {
    agentId: 'agt_1',
    applicationId: 'cli_app',
    credentials: { appId: 'cli_app', appSecret: 'real-secret' },
    enabled: true,
    id: BOT_ID,
    platform: 'feishu',
    settings: {},
    userId: 'user-1',
    workspaceId: 'ws-1',
  };

  it('omits the credentials field from list entirely', async () => {
    mockQuery.mockResolvedValue([row]);
    const caller = agentBotProviderRouter.createCaller(ctx);

    const [entry] = await caller.list();

    expect(entry).not.toHaveProperty('credentials');
    expect(JSON.stringify(entry)).not.toContain('real-secret');
  });

  it('masks the secret but keeps the identifier on the detail read', async () => {
    mockFindByAgentId.mockResolvedValue([row]);
    const caller = agentBotProviderRouter.createCaller(ctx);

    const [entry] = await caller.getByAgentId({ agentId: 'agt_1' });

    expect(entry.credentials).toEqual({ appId: 'cli_app', appSecret: CREDENTIAL_MASK });
  });

  it('restores the stored secret when an edit hands the mask back', async () => {
    mockFindById.mockResolvedValue(row);
    const caller = agentBotProviderRouter.createCaller(ctx);

    await caller.update({
      credentials: { appId: 'cli_app', appSecret: CREDENTIAL_MASK },
      id: BOT_ID,
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      BOT_ID,
      expect.objectContaining({ credentials: { appId: 'cli_app', appSecret: 'real-secret' } }),
    );
  });

  it('persists a genuinely rotated secret', async () => {
    mockFindById.mockResolvedValue(row);
    const caller = agentBotProviderRouter.createCaller(ctx);

    await caller.update({ credentials: { appSecret: 'rotated' }, id: BOT_ID });

    expect(mockUpdate).toHaveBeenCalledWith(
      BOT_ID,
      expect.objectContaining({ credentials: { appSecret: 'rotated' } }),
    );
  });

  it('hands back real credentials on the export read', async () => {
    // The one read that discloses, so a channel can be moved somewhere else.
    // It sits behind the write gate, which is what keeps viewers out.
    mockFindByAgentId.mockResolvedValue([row]);
    const caller = agentBotProviderRouter.createCaller(ctx);

    const [entry] = await caller.exportByAgentId({ agentId: 'agt_1' });

    expect(entry.credentials).toEqual({ appId: 'cli_app', appSecret: 'real-secret' });
    // Row identity stays out of the file: it is re-created on import.
    expect(entry).not.toHaveProperty('id');
  });

  it('will not export a workspace teammate’s channel to a non-owner', async () => {
    mockFindByAgentId.mockResolvedValue([{ ...row, userId: 'someone-else' }]);
    const caller = agentBotProviderRouter.createCaller({ ...ctx, workspaceRole: 'member' });

    await expect(caller.exportByAgentId({ agentId: 'agt_1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses to create a binding whose secret is the placeholder', async () => {
    const caller = agentBotProviderRouter.createCaller(ctx);

    await expect(
      caller.create({
        agentId: 'agt_1',
        applicationId: 'cli_app',
        credentials: { appSecret: CREDENTIAL_MASK },
        platform: 'feishu',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
