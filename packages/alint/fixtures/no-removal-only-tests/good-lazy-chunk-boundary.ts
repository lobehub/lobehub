// Fixture: a guard that keeps a store-backed route loader out of the entry chunk.
import { expect, it, vi } from 'vitest';

import { desktopRoutes } from './desktopRouter.config';
import { homeRecentsLoader } from './homeRecentsLoader';

const loaderModule = vi.hoisted(() => ({ evaluated: false }));

// Evaluating the real loader means the home store reached the entry chunk's
// first-screen graph through the route tables.
vi.mock('@/routes/home/homeRecentsLoader', () => {
  loaderModule.evaluated = true;
  return { homeRecentsLoader: vi.fn(async () => null) };
});

it('does not load the store-backed loader while the route tables load', () => {
  expect(loaderModule.evaluated).toBe(false);
});

it('pre-hydrates the recents on the home index route', () => {
  const home = desktopRoutes.find((route) => route.index);
  expect(home?.loader).toBe(homeRecentsLoader);
});
