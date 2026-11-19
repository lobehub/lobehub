import { afterEach, describe, expect, it, vi } from 'vitest';

import { artboardOpensInPanel, openArtboard } from './openArtboard';

const mocks = vi.hoisted(() => ({
  fullscreen: vi.fn(),
  get: vi.fn(),
  panel: vi.fn(),
}));

vi.mock('@/features/Artboard/Gallery/loader', () => ({ openArtboardFullscreen: mocks.fullscreen }));
vi.mock('@/services/artboard', () => ({ artboardService: { get: mocks.get } }));
vi.mock('./Conversation/openBoardPanel', () => ({ openBoardPanel: mocks.panel }));
vi.mock('./data/useArtboard', () => ({ mutateArtboard: vi.fn() }));
vi.mock('./loadArtboardTool', () => ({ loadArtboardTool: vi.fn() }));
vi.mock('./useArtboardFeature', () => ({ isArtboardEnabled: () => true }));

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

it('reaches the gallery through the specifier the Share build stubs', async () => {
  const source = await import('./openArtboard?raw');
  expect(source.default).toContain("from '@/features/Artboard/Gallery/loader'");
});

describe('artboardOpensInPanel', () => {
  it('uses the side panel inside the conversation the artboard belongs to', () => {
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_1', 'tpc_1')).toBe(true);
    expect(artboardOpensInPanel('/acme/project/prj_1/topic/tpc_1', 'tpc_1')).toBe(true);
  });

  it('uses the modal anywhere else', () => {
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_2', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_10', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1', 'tpc_1')).toBe(false);
    expect(artboardOpensInPanel('/project/prj_1/topic/tpc_1', null)).toBe(false);
  });
});

describe('openArtboard', () => {
  it('opens the side panel inside an agent conversation the artboard belongs to', async () => {
    window.history.replaceState(null, '', '/agent/agt_1/tpc_1');
    mocks.get.mockResolvedValue({ artboard: { id: 'art_1', topicId: 'tpc_1' } });

    await openArtboard('art_1');

    expect(mocks.panel).toHaveBeenCalledWith('art_1');
    expect(mocks.fullscreen).not.toHaveBeenCalled();
  });

  it('opens fullscreen from another conversation', async () => {
    window.history.replaceState(null, '', '/agent/agt_1/tpc_2');
    mocks.get.mockResolvedValue({ artboard: { id: 'art_1', topicId: 'tpc_1' } });

    await openArtboard('art_1');

    expect(mocks.fullscreen).toHaveBeenCalledWith('art_1');
    expect(mocks.panel).not.toHaveBeenCalled();
  });
});
