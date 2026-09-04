import { beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeBaseRuntime } from '../knowledgeBase';

const { trashKnowledgeBases } = vi.hoisted(() => ({
  trashKnowledgeBases: vi.fn(),
}));

vi.mock('@/server/services/trash', () => ({
  TrashService: vi.fn().mockImplementation(() => ({ trashKnowledgeBases })),
}));

describe('knowledgeBaseRuntime', () => {
  beforeEach(() => {
    trashKnowledgeBases.mockReset();
  });

  it('routes server-side knowledge base deletion through Trash', async () => {
    const runtime = knowledgeBaseRuntime.factory({
      serverDB: {} as never,
      toolManifestMap: {},
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    const result = await runtime.deleteKnowledgeBase({ id: 'kb-1' });

    expect(result.success).toBe(true);
    expect(trashKnowledgeBases).toHaveBeenCalledWith(['kb-1']);
  });
});
