import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { projectService } from '@/services/project';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    project: {
      list: { query: vi.fn() },
    },
  },
}));

describe('ProjectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads every project page', async () => {
    type ProjectRows = Awaited<ReturnType<typeof lambdaClient.project.list.query>>['data'];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
    })) as ProjectRows;
    const secondPage = [{ id: 'project-100' }] as ProjectRows;
    vi.mocked(lambdaClient.project.list.query)
      .mockResolvedValueOnce({ data: firstPage, success: true })
      .mockResolvedValueOnce({ data: secondPage, success: true });

    const response = await projectService.listAll();

    expect(response.data).toHaveLength(101);
    expect(lambdaClient.project.list.query).toHaveBeenNthCalledWith(1, {
      limit: 100,
      offset: 0,
    });
    expect(lambdaClient.project.list.query).toHaveBeenNthCalledWith(2, {
      limit: 100,
      offset: 100,
    });
  });
});
