// @vitest-environment node
import { MarketAPIError } from '@lobehub/market-sdk';
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillImportError } from '@/server/services/skill/errors';

import { agentSkillsRouter } from './agentSkills';

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  findByIdentifier: vi.fn(),
  importerConstructor: vi.fn(),
  importFromUrl: vi.fn(),
  modelConstructor: vi.fn(),
}));
vi.mock('@/libs/trpc/lambda', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { router: trpc.router };
});
vi.mock('@/libs/trpc/lambda/middleware', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { serverDatabase: trpc.middleware(({ next }) => next({ ctx: { serverDB: {} } })) };
});
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return { wsCompatProcedure: trpc.procedure };
});
vi.mock('@/business/server/trpc-middlewares/rbacPermission', async () => {
  const { trpc } = await import('@/libs/trpc/lambda/init');
  return {
    withScopedPermission: (action: string) =>
      trpc.middleware(({ ctx, next }) => {
        if (
          action !== 'agent:update' ||
          (ctx as { workspaceRole?: string }).workspaceRole === 'viewer'
        ) {
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
        return next({ ctx: { workspaceRole: 'member' } });
      }),
  };
});
vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: class {
    constructor(...args: unknown[]) {
      mocks.modelConstructor(...args);
    }
    findByIdentifier = mocks.findByIdentifier;
  },
}));
vi.mock('@/database/models/file', () => ({ FileModel: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('@/server/services/market', () => ({
  MarketService: class {
    getSkillDetail = mocks.detail;
    getSkillDownloadUrl = (id: string) => `https://market.example/${id}/download`;
  },
}));
vi.mock('@/server/services/skill', async () => ({
  ...(await import('@/server/services/skill/ensure')),
  ...(await import('@/server/services/skill/errors')),
  SkillImporter: class {
    constructor(...args: unknown[]) {
      mocks.importerConstructor(...args);
    }
    importFromUrl = mocks.importFromUrl;
  },
  SkillResourceService: class {},
}));
vi.mock('@lobechat/builtin-skills/manifests', () => ({ builtinSkillManifests: [] }));
vi.mock('@lobechat/builtin-tools/identifiers', () => ({
  builtinToolIdentifiers: ['builtin-tool'],
}));

const caller = (workspaceRole = 'member') =>
  agentSkillsRouter.createCaller({
    userId: 'user',
    workspaceId: 'workspace',
    workspaceRole,
  } as Parameters<typeof agentSkillsRouter.createCaller>[0]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.detail.mockResolvedValue({});
  mocks.findByIdentifier.mockResolvedValue(undefined);
  mocks.importFromUrl.mockResolvedValue({ status: 'created' });
});

describe('agentSkills.ensureFromMarket', () => {
  it('normalizes identifiers and imports using the RBAC-resolved workspace importer', async () => {
    await expect(caller().ensureFromMarket({ identifiers: [' a ', '', 'a'] })).resolves.toEqual([
      { identifier: 'a', status: 'installed' },
    ]);
    expect(mocks.modelConstructor).toHaveBeenCalledWith({}, 'user', 'workspace');
    expect(mocks.importerConstructor).toHaveBeenLastCalledWith({}, 'user', 'workspace', {
      workspaceRole: 'member',
    });
    expect(mocks.importFromUrl).toHaveBeenCalledWith(
      { url: 'https://market.example/a/download' },
      { identifier: 'a', overwrite: false, source: 'market' },
    );
  });

  it('applies the write gate before any market request or import', async () => {
    await expect(caller('viewer').ensureFromMarket({ identifiers: ['a'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(mocks.importFromUrl).not.toHaveBeenCalled();
  });

  it('rejects more than fifty distinct identifiers without importing', async () => {
    await expect(
      caller().ensureFromMarket({ identifiers: Array.from({ length: 51 }, (_, i) => `${i}`) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it('returns mixed states without failing the entire batch', async () => {
    mocks.findByIdentifier.mockImplementation(async (id) =>
      id === 'already' ? { source: 'market' } : undefined,
    );
    mocks.detail.mockImplementation(async (id) => {
      if (id === 'missing') throw new MarketAPIError(404, 'Not Found');
      if (id === 'forbidden') throw new MarketAPIError(403, 'Forbidden');
      return {};
    });
    mocks.importFromUrl.mockImplementation(async (_input, options) => {
      if (options.identifier === 'download-404')
        throw new SkillImportError('Download missing', 'NOT_FOUND');
      if (options.identifier === 'conflict')
        throw new SkillImportError('Name conflict', 'CONFLICT');
      return { status: 'created' };
    });
    await expect(
      caller().ensureFromMarket({
        identifiers: [
          'already',
          'builtin-tool',
          'missing',
          'forbidden',
          'download-404',
          'conflict',
          'new',
        ],
      }),
    ).resolves.toEqual([
      { identifier: 'already', status: 'installed' },
      { identifier: 'builtin-tool', status: 'skipped' },
      { identifier: 'missing', status: 'notSkill' },
      { identifier: 'forbidden', reason: 'unavailable', status: 'failed' },
      { identifier: 'download-404', reason: 'download', status: 'failed' },
      { identifier: 'conflict', reason: 'conflict', status: 'failed' },
      { identifier: 'new', status: 'installed' },
    ]);
  });
});
