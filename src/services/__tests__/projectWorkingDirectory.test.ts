import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { projectWorkingDirectoryService } from '@/services/projectWorkingDirectory';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    projectWorkingDirectory: {
      listTopics: { query: vi.fn() },
    },
  },
}));

describe('environment topics', () => {
  beforeEach(() => vi.clearAllMocks());
  it('merges all directory conversations across agents in newest-first order', async () => {
    vi.mocked(lambdaClient.projectWorkingDirectory.listTopics.query)
      .mockResolvedValueOnce({
        success: true,
        data: [{ id: 'a', agentId: 'writer', title: 'Draft', updatedAt: new Date('2026-09-01') }],
      } as Awaited<ReturnType<typeof lambdaClient.projectWorkingDirectory.listTopics.query>>)
      .mockResolvedValueOnce({
        success: true,
        data: [
          { id: 'b', agentId: 'reviewer', title: 'Review', updatedAt: new Date('2026-09-02') },
        ],
      } as Awaited<ReturnType<typeof lambdaClient.projectWorkingDirectory.listTopics.query>>);
    const result = await projectWorkingDirectoryService.listEnvironmentTopics([
      'directory-a',
      'directory-b',
    ]);
    expect(result.data.map((topic) => topic.id)).toEqual(['b', 'a']);
    expect(result.data.map((topic) => topic.agentId)).toEqual(['reviewer', 'writer']);
  });
  it('does not present a partial list as complete when a directory fails', async () => {
    vi.mocked(lambdaClient.projectWorkingDirectory.listTopics.query)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockRejectedValueOnce(new Error('Access denied'));
    await expect(projectWorkingDirectoryService.listEnvironmentTopics(['a', 'b'])).rejects.toThrow(
      'Access denied',
    );
  });
});
