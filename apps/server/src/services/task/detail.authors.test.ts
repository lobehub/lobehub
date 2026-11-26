// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskDetailService } from './detail';

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
  getAgentAvatarsByIds: vi.fn(),
  getNicknames: vi.fn(),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentAvatarsByIds: mocks.getAgentAvatarsByIds };
  }),
}));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn(), taskActivityActor: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/user', () => ({ UserModel: { findByIds: mocks.findByIds } }));
vi.mock('@/database/models/workspaceMember', () => ({
  WorkspaceMemberModel: vi.fn(function () {
    return { getNicknames: mocks.getNicknames };
  }),
}));

type Resolve = (
  agentIds: Set<string>,
  userIds: Set<string>,
) => Promise<Map<string, { name?: string | null }>>;
const resolveAuthors = (service: TaskDetailService): Resolve =>
  (service as unknown as { resolveAuthors: Resolve }).resolveAuthors.bind(service);

describe('TaskDetailService author names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentAvatarsByIds.mockResolvedValue([]);
    mocks.findByIds.mockResolvedValue([
      { avatar: null, fullName: 'Mira Chen', id: 'u1', username: 'mira' },
      { avatar: null, fullName: null, id: 'u2', username: 'leo' },
    ]);
    mocks.getNicknames.mockResolvedValue(new Map([['u1', 'Kuro']]));
  });

  it('labels a workspace member by the nickname they set there', async () => {
    const service = new TaskDetailService({} as never, 'viewer', 'ws-1');

    const authors = await resolveAuthors(service)(new Set(), new Set(['u1', 'u2']));

    expect(mocks.getNicknames).toHaveBeenCalledWith('ws-1', ['u1', 'u2']);
    expect(authors.get('u1')?.name).toBe('Kuro');
    expect(authors.get('u2')?.name).toBe('leo');
  });

  it('keeps account names outside a workspace', async () => {
    const service = new TaskDetailService({} as never, 'viewer');

    const authors = await resolveAuthors(service)(new Set(), new Set(['u1']));

    expect(mocks.getNicknames).not.toHaveBeenCalled();
    expect(authors.get('u1')?.name).toBe('Mira Chen');
  });
});
