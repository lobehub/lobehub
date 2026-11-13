import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';

import { openBoardPanel } from './openBoardPanel';

const feature = vi.hoisted(() => ({ enabled: true }));
vi.mock('../useArtboardFeature', () => ({ isArtboardEnabled: () => feature.enabled }));

describe('openBoardPanel', () => {
  const openWorkingSidebar = vi.fn();

  beforeEach(() => {
    openWorkingSidebar.mockReset();
    feature.enabled = true;
    useGlobalStore.setState({ openWorkingSidebar } as never);
  });

  it('opens the artboard as a tab of the working sidebar', () => {
    openBoardPanel('art_1');
    expect(openWorkingSidebar).toHaveBeenCalledWith('artboard:art_1');
  });

  it('does nothing while the feature is off', () => {
    feature.enabled = false;
    openBoardPanel('art_1');
    expect(openWorkingSidebar).not.toHaveBeenCalled();
  });
});
