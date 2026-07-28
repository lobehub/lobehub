import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from './agent.service';

const { agentCreate } = vi.hoisted(() => ({ agentCreate: vi.fn() }));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({ create: agentCreate })),
}));
vi.mock('@/database/schemas', () => ({ agents: {}, agentsToSessions: {} }));
vi.mock('@/database/utils/idGenerator', () => ({
  idGenerator: vi.fn().mockReturnValue('agent-openapi'),
  randomSlug: vi.fn().mockReturnValue('openapi-slug'),
}));
vi.mock('../common/base.service', () => ({
  BaseService: class {
    protected db: unknown;
    protected userId: string;
    protected workspaceId?: string;

    constructor(db: unknown, userId: string | null, workspaceId?: string) {
      this.db = db;
      this.userId = userId || '';
      this.workspaceId = workspaceId;
    }

    protected handleServiceError(error: unknown): never {
      throw error;
    }

    protected log() {}
  },
}));

describe('AgentService.createAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentCreate.mockResolvedValue({
      id: 'agent-openapi',
      plugins: [{ identifier: 'existing-custom-skill', mode: 'disabled' }],
      slug: 'openapi-slug',
      title: 'OpenAPI Agent',
    });
  });

  it('uses AgentModel.create so scoped skill defaults are applied', async () => {
    const result = await new AgentService({} as never, 'user-1').createAgent({
      title: 'OpenAPI Agent',
    });

    expect(agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-openapi',
        slug: 'openapi-slug',
        title: 'OpenAPI Agent',
      }),
    );
    expect(result.plugins).toEqual([{ identifier: 'existing-custom-skill', mode: 'disabled' }]);
  });
});
