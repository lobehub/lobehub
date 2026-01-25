// @vitest-environment node
import { LayersEnum, TypesEnum } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { UserMemoryModel } from '@/database/models/userMemory';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import { userMemoriesRouter } from './userMemories';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: vi.fn().mockReturnValue({
    embeddingModel: { model: 'text-embedding-3-small' },
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

vi.mock('@/database/models/userMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/database/models/userMemory')>();
  const mockUserMemoryModel: any = vi.fn();
  mockUserMemoryModel.parseDateFromString = actual.UserMemoryModel.parseDateFromString;
  mockUserMemoryModel.parseAssociatedLocations = actual.UserMemoryModel.parseAssociatedLocations;
  mockUserMemoryModel.parseAssociatedObjects = actual.UserMemoryModel.parseAssociatedObjects;
  mockUserMemoryModel.parseAssociatedSubjects = actual.UserMemoryModel.parseAssociatedSubjects;
  return {
    ...actual,
    UserMemoryModel: mockUserMemoryModel,
  } satisfies typeof import('@/database/models/userMemory');
});

const embeddingsMock = vi.fn();
const mockCtx = { authorizationHeader: 'Bearer mock-token', userId: 'test-user' };

beforeEach(() => {
  vi.clearAllMocks();

  embeddingsMock.mockImplementation(async ({ input }: { input: string[] | string }) => {
    const items = Array.isArray(input) ? input : [input];
    return items.map((_, index) => [index + 1]);
  });

  vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
    embeddings: embeddingsMock,
  } as any);
});

describe('memoryRouter.reEmbedMemories', () => {
  it('re-embeds memories across tables and returns aggregate stats', async () => {
    const updateUserMemoryVectors = vi.fn().mockResolvedValue(undefined);
    const updateContextVectors = vi.fn().mockResolvedValue(undefined);
    const updatePreferenceVectors = vi.fn().mockResolvedValue(undefined);
    const updateIdentityVectors = vi.fn().mockResolvedValue(undefined);
    const updateExperienceVectors = vi.fn().mockResolvedValue(undefined);
    const updateActivityVectors = vi.fn().mockResolvedValue(undefined);

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          updateContextVectors,
          updateExperienceVectors,
          updateIdentityVectors,
          updateActivityVectors,
          updatePreferenceVectors,
          updateUserMemoryVectors,
        }) as any,
    );

    const userMemoriesRows = [{ id: 'memory-1', details: 'detail text', summary: 'summary text' }];
    const contextsRows = [{ id: 'context-1', description: 'context text' }];
    const preferencesRows = [{ id: 'preference-1', conclusionDirectives: 'directive text' }];
    const identitiesRows = [{ id: 'identity-1', description: 'identity text' }];
    const experiencesRows = [
      {
        action: 'action text',
        id: 'experience-1',
        keyLearning: 'learning text',
        situation: 'situation text',
      },
    ];
    const activitiesRows = [
      { feedback: 'feedback text', id: 'activity-1', narrative: 'narrative text' },
    ];

    const dbStub = {
      query: {
        userMemories: {
          findMany: vi.fn().mockResolvedValue(userMemoriesRows),
        },
        userMemoriesContexts: {
          findMany: vi.fn().mockResolvedValue(contextsRows),
        },
        userMemoriesExperiences: {
          findMany: vi.fn().mockResolvedValue(experiencesRows),
        },
        userMemoriesIdentities: {
          findMany: vi.fn().mockResolvedValue(identitiesRows),
        },
        userMemoriesPreferences: {
          findMany: vi.fn().mockResolvedValue(preferencesRows),
        },
        userMemoriesActivities: {
          findMany: vi.fn().mockResolvedValue(activitiesRows),
        },
      },
    } as const;

    vi.mocked(getServerDB).mockResolvedValue(dbStub as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const result = await caller.reEmbedMemories();

    expect(result.success).toBe(true);
    expect(result.aggregate).toEqual({ failed: 0, skipped: 0, succeeded: 6, total: 6 });
    expect(result.results?.userMemories).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });
    expect(result.results?.contexts).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });
    expect(result.results?.preferences).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });
    expect(result.results?.identities).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });
    expect(result.results?.experiences).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });
    expect(result.results?.activities).toEqual({ failed: 0, skipped: 0, succeeded: 1, total: 1 });

    expect(updateUserMemoryVectors).toHaveBeenCalledWith('memory-1', {
      detailsVector1024: [2],
      summaryVector1024: [1],
    });
    expect(updateContextVectors).toHaveBeenCalledWith('context-1', {
      descriptionVector: [1],
    });
    expect(updatePreferenceVectors).toHaveBeenCalledWith('preference-1', {
      conclusionDirectivesVector: [1],
    });
    expect(updateIdentityVectors).toHaveBeenCalledWith('identity-1', {
      descriptionVector: [1],
    });
    expect(updateExperienceVectors).toHaveBeenCalledWith('experience-1', {
      actionVector: [2],
      keyLearningVector: [3],
      situationVector: [1],
    });
    expect(updateActivityVectors).toHaveBeenCalledWith('activity-1', {
      feedbackVector: [2],
      narrativeVector: [1],
    });

    expect(embeddingsMock).toHaveBeenCalledTimes(6);
  });
});

describe('userMemories.queryMemories', () => {
  it('forwards filters and pagination to the model and returns the result', async () => {
    const queryMemories = vi.fn().mockResolvedValue({
      items: [{ id: 'mem-1' }],
      page: 2,
      pageSize: 5,
      total: 1,
    });

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          queryMemories,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const input = {
      categories: ['work'],
      layer: 'context',
      order: 'asc' as const,
      page: 2,
      pageSize: 5,
      q: 'atlas',
      sort: 'scoreImpact' as const,
      tags: ['project'],
      types: ['topic'],
    };

    const result = await caller.queryMemories(input as any);

    expect(queryMemories).toHaveBeenCalledWith({
      ...input,
      order: 'asc',
      sort: 'scoreImpact',
    });
    expect(result).toEqual({
      items: [{ id: 'mem-1' }],
      page: 2,
      pageSize: 5,
      total: 1,
    });
  });

  it('applies default sort and order when not provided', async () => {
    const queryMemories = vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          queryMemories,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    await caller.queryMemories();

    expect(queryMemories).toHaveBeenCalledWith({
      order: 'desc',
    });
  });
});

describe('userMemories.getMemoryDetail', () => {
  it('forwards memory id to model and returns detail', async () => {
    const getMemoryDetail = vi.fn().mockResolvedValue({ id: 'mem-1', layer: 'experience' });

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          getMemoryDetail,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const result = await caller.getMemoryDetail({
      id: 'mem-1',
      layer: LayersEnum.Experience,
    } as any);

    expect(getMemoryDetail).toHaveBeenCalledWith({
      id: 'mem-1',
      layer: LayersEnum.Experience,
    });
    expect(result).toEqual({ id: 'mem-1', layer: 'experience' });
  });

  it('returns null when model throws', async () => {
    const getMemoryDetail = vi.fn().mockRejectedValue(new Error('boom'));

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          getMemoryDetail,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const result = await caller.getMemoryDetail({
      id: 'mem-1',
      layer: LayersEnum.Experience,
    } as any);

    expect(result).toBeNull();
  });
});

describe('userMemories.retrieveMemory', () => {
  it('returns aggregated memory search results', async () => {
    const searchWithEmbedding = vi.fn().mockResolvedValue({
      activities: [],
      contexts: [
        {
          accessedAt: new Date('2024-01-01T00:00:00.000Z'),
          associatedObjects: [{ name: 'Roadmap' }],
          associatedSubjects: [{ name: 'Atlas Team' }],
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          currentStatus: 'active',
          description: 'Coordinating weekly syncs for Project Atlas',
          id: 'ctx-1',
          metadata: { priority: 'high' },
          scoreImpact: 0.9,
          scoreUrgency: 0.6,
          tags: ['project', 'atlas'],
          title: 'Project Atlas coordination',
          type: 'project',
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          userMemoryIds: ['mem-1'],
        },
      ],
      experiences: [
        {
          accessedAt: new Date('2024-01-03T00:00:00.000Z'),
          action: 'Facilitated sprint planning',
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          id: 'exp-1',
          keyLearning: 'Team wants clearer milestones',
          metadata: { feedback: 'positive' },
          possibleOutcome: 'Improved roadmap transparency',
          reasoning: 'Helps unblock design team',
          scoreConfidence: 0.8,
          situation: 'Sprint 5 planning',
          tags: ['planning'],
          type: 'meeting',
          updatedAt: new Date('2024-01-02T12:00:00.000Z'),
          userMemoryId: 'mem-2',
        },
      ],
      preferences: [
        {
          accessedAt: new Date('2024-01-03T00:00:00.000Z'),
          conclusionDirectives: 'Always provide concise weekly status updates for Project Atlas',
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          id: 'pref-1',
          metadata: { channel: 'email' },
          scorePriority: 0.7,
          suggestions: ['Prepare summary every Friday'],
          tags: ['communication'],
          type: 'workflow',
          updatedAt: new Date('2024-01-02T12:00:00.000Z'),
          userMemoryId: 'mem-3',
        },
      ],
    });

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          searchWithEmbedding,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const result = await caller.searchMemory({
      query: 'Project Atlas',
      topK: { activities: 1, contexts: 1, experiences: 1, preferences: 1 },
    });

    expect(embeddingsMock).toHaveBeenCalledTimes(1);
    expect(searchWithEmbedding.mock.calls[0][0]).toBeTypeOf('object');
    expect(searchWithEmbedding.mock.calls[0][0]).toStrictEqual({
      embedding: [1],
      limits: { activities: 1, contexts: 1, experiences: 1, preferences: 1 },
    });

    expect(result.contexts[0]).toMatchObject({
      id: 'ctx-1',
      title: 'Project Atlas coordination',
      currentStatus: 'active',
    });
    expect(result.experiences[0]).toMatchObject({
      id: 'exp-1',
      situation: 'Sprint 5 planning',
    });
    expect(result.preferences[0]).toMatchObject({
      id: 'pref-1',
      conclusionDirectives: 'Always provide concise weekly status updates for Project Atlas',
    });
  });
});

describe('userMemories.toolAddActivityMemory', () => {
  it('creates activity memory with embeddings and normalized fields', async () => {
    const createActivityMemory = vi.fn().mockResolvedValue({
      activity: { id: 'activity-1' },
      memory: { id: 'memory-1' },
    });

    vi.mocked(UserMemoryModel).mockImplementation(
      () =>
        ({
          createActivityMemory,
        }) as any,
    );

    vi.mocked(getServerDB).mockResolvedValue({
      query: {},
    } as any);

    const caller = userMemoriesRouter.createCaller(mockCtx as any);

    const input = {
      details: 'Discussed roadmap',
      memoryCategory: 'work',
      memoryType: TypesEnum.Activity,
      summary: 'Roadmap sync with Alice',
      tags: ['meeting'],
      title: 'Roadmap sync',
      withActivity: {
        associatedLocations: [{ name: 'HQ', type: 'place' }],
        associatedObjects: [{ name: 'Slides', type: 'item' }],
        associatedSubjects: [{ name: 'Alice', type: 'person' }],
        endsAt: '2024-05-01T11:00:00Z',
        feedback: 'Productive',
        metadata: { source: 'chat' },
        narrative: 'We reviewed milestones and risks',
        notes: 'Follow up with action items',
        startsAt: '2024-05-01T10:00:00Z',
        status: 'completed',
        tags: ['product'],
        timezone: 'UTC',
        type: 'meeting',
      },
    };

    const result = await caller.toolAddActivityMemory(input as any);

    expect(createActivityMemory).toHaveBeenCalledTimes(1);
    expect(createActivityMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          associatedLocations: [{ name: 'HQ', type: 'place' }],
          associatedObjects: [{ name: 'Slides' }],
          associatedSubjects: [{ name: 'Alice' }],
          endsAt: new Date('2024-05-01T11:00:00Z'),
          feedback: 'Productive',
          metadata: { source: 'chat' },
          narrative: 'We reviewed milestones and risks',
          notes: 'Follow up with action items',
          startsAt: new Date('2024-05-01T10:00:00Z'),
          status: 'completed',
          tags: ['product'],
          timezone: 'UTC',
          type: 'meeting',
        }),
        memoryLayer: LayersEnum.Activity,
        memoryType: TypesEnum.Activity,
        summaryEmbedding: [1],
      }),
    );

    expect(result).toEqual({
      activityId: 'activity-1',
      memoryId: 'memory-1',
      message: 'Memory saved successfully',
      success: true,
    });
    expect(embeddingsMock).toHaveBeenCalledTimes(4);
  });
});
