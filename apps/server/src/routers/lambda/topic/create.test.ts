// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

const mockTopicBatchCreate = vi.fn();
const mockTopicCreate = vi.fn();
vi.mock('@/database/repositories/topic', () => ({
  TopicRepository: vi.fn(function () {
    return { batchCreate: mockTopicBatchCreate, create: mockTopicCreate };
  }),
}));

const mockProjectFindById = vi.fn();
vi.mock('@/database/models/project', () => ({
  ProjectModel: vi.fn(function () {
    return { findById: mockProjectFindById };
  }),
}));

vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCanUseConversationTargets: vi.fn(),
}));
vi.mock('../_helpers/shareVisitorTargetGuard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  assertCreatorMessageTargets: vi.fn(),
}));

let inFlight = 0;
let maxInFlight = 0;
vi.mock('../_helpers/resolveContext', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveContextWithAgentId: vi.fn(async (input: { agentId?: string }) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Later items settle first, so result order must not follow completion order.
    const index = Number(input.agentId?.split('-')[1]);
    await new Promise((resolve) => setTimeout(resolve, 20 - index));
    inFlight -= 1;
    return { agentId: input.agentId, sessionId: `session-${index}` };
  }),
}));

const { topicRouter } = await import('./index');

const caller = () => topicRouter.createCaller({ userId: 'user-1' } as any);

describe('topic.batchCreateTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inFlight = 0;
    maxInFlight = 0;
    mockTopicBatchCreate.mockImplementation(async (rows: unknown[]) => rows);
  });

  it('resolves every item in input order with bounded concurrency', async () => {
    const input = Array.from({ length: 12 }, (_, index) => ({
      agentId: `agent-${index}`,
      title: `Topic ${index}`,
    }));

    const result = await caller().batchCreateTopics(input);

    expect(result).toEqual({ added: 12, ids: [], skips: [], success: true });
    expect(mockTopicBatchCreate).toHaveBeenCalledWith(
      input.map((item, index) => ({ ...item, sessionId: `session-${index}` })),
    );
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });
});

describe('topic.createTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopicCreate.mockResolvedValue({ id: 'tpc_new' });
  });

  /** @example User report: a project "+" with no runnable directory left an untitled topic behind. */
  it('creates a conversation-only topic inside a project the user can read', async () => {
    mockProjectFindById.mockResolvedValue({ id: 'prj_1' });

    await caller().createTopic({ agentId: 'agent-1', projectId: 'prj_1', title: 'Hi' });

    expect(mockProjectFindById).toHaveBeenCalledWith('prj_1');
    expect(mockTopicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', projectId: 'prj_1', title: 'Hi' }),
    );
  });

  it('refuses a project the user cannot read', async () => {
    mockProjectFindById.mockResolvedValue(undefined);

    await expect(
      caller().createTopic({ agentId: 'agent-1', projectId: 'prj_other', title: 'Hi' }),
    ).rejects.toThrow('Project not found');
    expect(mockTopicCreate).not.toHaveBeenCalled();
  });
});
