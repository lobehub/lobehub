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
  it('remembers the page of each board for the session', () => {
    artboardActions.bindBoard('art_1');
    artboardActions.setPage('p2');
    artboardActions.bindBoard('art_2');
    expect(useArtboardStore.getState().pageId).toBeNull();

    artboardActions.bindBoard('art_1');

    expect(useArtboardStore.getState().pageId).toBe('p2');
  });

  it('switches page, selects and aims the camera when jumping to an item', () => {
    artboardActions.bindBoard('art_1');
    artboardActions.setMode('verify');

    artboardActions.goTo({ id: 'b4', kind: 'item', pageId: 'p2' });

    expect(useArtboardStore.getState()).toMatchObject({
      camera: { id: 'b4', kind: 'item' },
      mode: 'discuss',
      pageId: 'p2',
      selected: 'b4',
    });
  });

  it('closes the open thread and the selection when the page changes', () => {
    artboardActions.bindBoard('art_1');
    artboardActions.select('b1');
    artboardActions.openThread('t1');

    artboardActions.setPage('p2');

    expect(useArtboardStore.getState()).toMatchObject({ openThreadId: null, selected: null });
  });

  it('opens a thread on its page and aims the camera at its board', () => {
    artboardActions.bindBoard('art_1');

    artboardActions.showThread({ boardId: 'b4', id: 't9', pageId: 'p2' });

    expect(useArtboardStore.getState()).toMatchObject({
      camera: { id: 'b4', kind: 'item' },
      openThreadId: 't9',
      pageId: 'p2',
    });
  });

  it('drops the selection when the comment tool is picked', () => {
    artboardActions.bindBoard('art_1');
    artboardActions.select('b1');

    artboardActions.setTool('comment');

    expect(useArtboardStore.getState()).toMatchObject({ selected: null, tool: 'comment' });
  });

  it('keeps the Works flag while boards change', () => {
    artboardActions.setGallery(true);
    artboardActions.bindBoard('art_3');

    expect(useArtboardStore.getState().gallery).toBe(true);
  });
  it('keeps one of a new-comment draft or an open thread, and drops the draft with the tool', () => {
    const draft = { anchor: { type: 'canvas' as const, x: 1, y: 2 }, pageId: 'p1', x: 1, y: 2 };
    artboardActions.bindBoard('art_1');
    artboardActions.setTool('comment');
    artboardActions.openThread('t1');

    artboardActions.placeDraft(draft);
    expect(useArtboardStore.getState()).toMatchObject({ draft, openThreadId: null });

    artboardActions.openThread('t2');
    expect(useArtboardStore.getState()).toMatchObject({ draft: null, openThreadId: 't2' });

    artboardActions.placeDraft(draft);
    artboardActions.setTool('select');
    expect(useArtboardStore.getState().draft).toBeNull();
  });
});
