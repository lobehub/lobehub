import { beforeEach, describe, expect, it, vi } from 'vitest';

const preHydrateStatsPage = vi.hoisted(() => vi.fn());

vi.mock('@/store/stats', () => ({ statsActions: { preHydrateStatsPage } }));

const { settingsTabLoader, statsPageLoader } = await import('./statsPageLoader');

const args = (tab: string) => ({ params: { tab } }) as never;

describe('statsPageLoader', () => {
  beforeEach(() => {
    preHydrateStatsPage.mockReset();
  });

  it('seeds the stats replicas on a static stats route, which carries no `:tab` param', async () => {
    preHydrateStatsPage.mockResolvedValue([]);

    await expect(statsPageLoader()).resolves.toBeNull();
    expect(preHydrateStatsPage).toHaveBeenCalledTimes(1);
  });

  it('does not hold the route on a slow storage read', async () => {
    preHydrateStatsPage.mockReturnValue(new Promise(() => {}));

    await expect(statsPageLoader()).resolves.toBeNull();
  });
});

describe('settingsTabLoader', () => {
  beforeEach(() => {
    preHydrateStatsPage.mockReset();
    preHydrateStatsPage.mockResolvedValue([]);
  });

  it('seeds the stats replicas before the stats tab commits', async () => {
    await expect(settingsTabLoader(args('stats'))).resolves.toBeNull();
    expect(preHydrateStatsPage).toHaveBeenCalledTimes(1);
  });

  it('leaves other settings tabs alone', async () => {
    await settingsTabLoader(args('appearance'));
    expect(preHydrateStatsPage).not.toHaveBeenCalled();
  });
});
