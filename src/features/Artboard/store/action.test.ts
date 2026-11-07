import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { artboardActions } from './action';
import { useArtboardStore } from './store';

describe('artboardActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    artboardActions.reset();
    vi.useRealTimers();
  });

  it('closes the side panels again when a narrow board is revisited', () => {
    artboardActions.setNarrow(true);
    artboardActions.reset();
    expect(useArtboardStore.getState().verifyOpen).toBe(true);

    artboardActions.setNarrow(true);

    expect(useArtboardStore.getState()).toMatchObject({ outlineOpen: false, verifyOpen: false });
  });

  it('drops the selection and mode of the previous board when another board opens', () => {
    artboardActions.bindBoard('art_1');
    artboardActions.setMode('verify');
    artboardActions.select('f1');

    artboardActions.bindBoard('art_1');
    expect(useArtboardStore.getState()).toMatchObject({ mode: 'verify', selected: 'f1' });

    artboardActions.bindBoard('art_2');
    expect(useArtboardStore.getState()).toMatchObject({
      boardId: 'art_2',
      mode: 'discuss',
      selected: null,
    });
  });

  it('flashes the changed items and then clears them', () => {
    artboardActions.flashItems(['f1', 'f2']);
    expect(useArtboardStore.getState().flash).toEqual(['f1', 'f2']);

    vi.advanceTimersByTime(1700);

    expect(useArtboardStore.getState().flash).toEqual([]);
  });

  it('aims the camera at the journey when acceptance opens', () => {
    artboardActions.setNarrow(false);
    artboardActions.setVerifyOpen(false);

    artboardActions.setMode('verify');

    expect(useArtboardStore.getState()).toMatchObject({
      camera: { kind: 'journey' },
      mode: 'verify',
      verifyOpen: true,
    });
  });

  it('keeps the acceptance sheet closed on a narrow board so the flow stays visible', () => {
    artboardActions.setNarrow(true);

    artboardActions.setMode('verify');

    expect(useArtboardStore.getState()).toMatchObject({ mode: 'verify', verifyOpen: false });
  });
});
