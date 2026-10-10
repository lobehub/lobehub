import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { projectService } from './project';

vi.mock('@/libs/trpc/client', () => ({
  createWorkspaceLambdaClient: vi.fn(),
  lambdaClient: { project: { list: { query: vi.fn() } } },
}));

const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `proj_${i}`, name: `Project ${i}` }));

/** Serve `total` projects through the router's offset pagination. */
const serve = (total: number) => {
  const all = rows(total);
  vi.mocked(lambdaClient.project.list.query).mockImplementation((async ({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }) => ({ data: all.slice(offset, offset + limit), success: true })) as any);
  return all;
};

describe('projectService.listAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([0, 99, 100, 250])(
    'returns every one of %i projects, past the router page limit',
    async (total) => {
      const all = serve(total);

      const { data } = await projectService.listAll();

      expect(data.map((project) => project.id)).toEqual(all.map((project) => project.id));
      const pages = vi.mocked(lambdaClient.project.list.query).mock.calls.map(([input]) => input);
      expect(pages.every((input) => input.limit === 100)).toBe(true);
      expect(pages.map((input) => input.offset)).toEqual(
        Array.from({ length: Math.floor(total / 100) + 1 }, (_, i) => i * 100),
      );
    },
  );
});
