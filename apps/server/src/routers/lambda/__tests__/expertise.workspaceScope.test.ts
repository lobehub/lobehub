// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpertiseModel } from '@/database/models/expertise';
import { ExpertiseDomainService } from '@/server/services/expertise/domain';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';

import { expertiseRouter } from '../expertise';

const workspaceAuthHits = vi.hoisted(() => ({ compat: 0, roles: [] as string[] }));

vi.mock('@/database/models/expertise', () => ({ ExpertiseModel: vi.fn() }));
vi.mock('@/server/services/expertise/domain', () => ({
  DomainDraftSchema: { extend: () => ({ parse: (v: unknown) => v }) },
  EditableDomainDraftSchema: { optional: () => ({ parse: (v: unknown) => v }) },
  ExpertiseDomainService: vi.fn(),
}));
vi.mock('@/server/services/expertise/ingestion', () => ({
  ExpertiseIngestionService: vi.fn(),
}));
vi.mock('@/server/workflows/expertiseHistory', () => ({
  ExpertiseHistoryWorkflow: { trigger: vi.fn() },
}));
// The router must resolve the workspace through the shared workspace-auth
// middlewares — that is what makes `X-Workspace-Id` a membership-checked scope
// in the cloud build instead of a caller-supplied string.
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async () => {
  const mod = await vi.importActual<{ trpc: any }>('@/libs/trpc/lambda/init');
  return {
    requireWorkspaceRoleWhenScoped: (role: string) =>
      mod.trpc.middleware(async (opts: any) => {
        workspaceAuthHits.roles.push(role);
        return opts.next();
      }),
    wsCompatProcedure: mod.trpc.procedure.use(async (opts: any) => {
      workspaceAuthHits.compat += 1;
      return opts.next();
    }),
  };
});
vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: async (opts: any) =>
    opts.next({ ctx: { ...opts.ctx, serverDB: opts.ctx.serverDB ?? {} } }),
}));

describe('expertiseRouter — workspace scoping', () => {
  let model: any;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceAuthHits.compat = 0;
    workspaceAuthHits.roles = [];
    model = {
      deleteDomain: vi.fn().mockResolvedValue({ id: 'domain-1' }),
      latestSnapshots: vi.fn().mockResolvedValue([]),
      listDomainsForAgent: vi.fn().mockResolvedValue([]),
      listLessonsWithRecent: vi.fn().mockResolvedValue([]),
      reliabilitySeries: vi.fn().mockResolvedValue([]),
      seriesForDomains: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(ExpertiseModel).mockImplementation(() => model);
    vi.mocked(ExpertiseDomainService).mockImplementation(() => ({}) as any);
    vi.mocked(ExpertiseIngestionService).mockImplementation(() => ({}) as any);
  });

  const callerFor = (workspaceId?: string) =>
    expertiseRouter.createCaller({
      serverDB: {},
      userId: 'user_test',
      workspaceId: workspaceId ?? null,
    } as any);

  it('routes reads through wsCompatProcedure and builds workspace-scoped models', async () => {
    await callerFor('ws-1').listByAgent({ agentId: 'agent-1' });

    expect(workspaceAuthHits.compat).toBe(1);
    expect(vi.mocked(ExpertiseModel)).toHaveBeenCalledWith({}, 'user_test', 'ws-1');
    expect(vi.mocked(ExpertiseIngestionService)).toHaveBeenCalledWith({}, 'user_test', 'ws-1');
  });

  it('keeps personal calls personal (no workspace) for the models', async () => {
    await callerFor().listByAgent({ agentId: 'agent-1' });

    expect(vi.mocked(ExpertiseModel)).toHaveBeenCalledWith({}, 'user_test', undefined);
  });

  it('requires member standing for writes when workspace-scoped', async () => {
    await callerFor('ws-1').deleteDomain({ domainId: 'domain-1' });

    expect(workspaceAuthHits.roles).toEqual(['member']);
    expect(model.deleteDomain).toHaveBeenCalledWith('domain-1');
  });

  it('does not put a role gate in front of reads', async () => {
    await callerFor('ws-1').listByAgent({ agentId: 'agent-1' });

    expect(workspaceAuthHits.roles).toEqual([]);
  });
});
