import { beforeEach, describe, expect, it, vi } from 'vitest';

const preHydrateStatsPage = vi.hoisted(() => vi.fn());

vi.mock('@/store/stats', () => ({ statsActions: { preHydrateStatsPage } }));

const { statsPageLoader } = await import('./statsPageLoader');

const args = (tab: string) => ({ params: { tab } }) as never;

describe('statsPageLoader', () => {
  beforeEach(() => {
    preHydrateStatsPage.mockReset();
  });

  it('seeds the stats replicas before the stats tab commits', async () => {
    preHydrateStatsPage.mockResolvedValue([]);

    await expect(statsPageLoader(args('stats'))).resolves.toBeNull();
    expect(preHydrateStatsPage).toHaveBeenCalledTimes(1);
  });

  it('leaves other settings tabs alone', async () => {
    await statsPageLoader(args('appearance'));
    expect(preHydrateStatsPage).not.toHaveBeenCalled();
  });

  it('does not hold the route on a slow storage read', async () => {
    preHydrateStatsPage.mockReturnValue(new Promise(() => {}));

    await expect(statsPageLoader(args('stats'))).resolves.toBeNull();
  });
});
