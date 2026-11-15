import { describe, expect, it } from 'vitest';

import {
  type DragItem,
  type DropTarget,
  getRelativeY,
  normalizeParentKey,
  resolveDropPosition,
} from './dragDropPosition';

const drag = (overrides: Partial<DragItem> = {}): DragItem => ({
  id: 'dragged',
  parentKey: '',
  type: 'folder',
  ...overrides,
});

const target = (overrides: Partial<DropTarget> = {}): DropTarget => ({
  id: 'target',
  isFolder: true,
  parentKey: '',
  ...overrides,
});

const resolve = (
  dragItem: DragItem,
  targetItem: DropTarget,
  relY: number,
  libraryId: string | null | undefined = 'kb-1',
) => resolveDropPosition({ drag: dragItem, libraryId, relY, target: targetItem });

describe('normalizeParentKey', () => {
  it('maps the root spellings to an empty key', () => {
    expect(normalizeParentKey(null)).toBe('');
    expect(normalizeParentKey(undefined)).toBe('');
    expect(normalizeParentKey('')).toBe('');
    expect(normalizeParentKey('folder-1')).toBe('folder-1');
  });
});

describe('getRelativeY', () => {
  it('returns the pointer position as a fraction of the row height', () => {
    expect(getRelativeY(150, { height: 40, top: 130 })).toBe(0.5);
  });

  it('clamps to the row bounds and tolerates a zero-height rect', () => {
    expect(getRelativeY(100, { height: 40, top: 130 })).toBe(0);
    expect(getRelativeY(200, { height: 40, top: 130 })).toBe(1);
    expect(getRelativeY(150, { height: 0, top: 130 })).toBe(0.5);
  });
});

describe('resolveDropPosition', () => {
  it('rejects dropping a row onto itself', () => {
    expect(resolve(drag({ id: 'same' }), target({ id: 'same' }), 0.5)).toBeNull();
    expect(
      resolve(drag({ id: 'same', type: 'file' }), target({ id: 'same', isFolder: false }), 0.9),
    ).toBeNull();
  });

  describe('flat search targets', () => {
    it.each([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])(
      'keeps folders as inside targets at relative height %s when reordering is disabled',
      (relY) => {
        expect(
          resolveDropPosition({
            allowReorder: false,
            drag: drag(),
            libraryId: 'kb-1',
            relY,
            target: target(),
          }),
        ).toBe('inside');
      },
    );

    it.each([0, 0.1, 0.5, 0.9, 1])(
      'rejects files at relative height %s when reordering is disabled',
      (relY) => {
        expect(
          resolveDropPosition({
            allowReorder: false,
            drag: drag({ type: 'file' }),
            libraryId: 'kb-1',
            relY,
            target: target({ isFolder: false }),
          }),
        ).toBeNull();
      },
    );
  });

  describe('folder targets', () => {
    it('splits a sibling folder drag into before / inside / after', () => {
      expect(resolve(drag({ parentKey: 'p' }), target({ parentKey: 'p' }), 0.1)).toBe('before');
      expect(resolve(drag({ parentKey: 'p' }), target({ parentKey: 'p' }), 0.5)).toBe('inside');
      expect(resolve(drag({ parentKey: 'p' }), target({ parentKey: 'p' }), 0.9)).toBe('after');
    });

    it('keeps the whole row as an inside target when dragging a file', () => {
      expect(resolve(drag({ type: 'file', parentKey: 'p' }), target({ parentKey: 'p' }), 0.1)).toBe(
        'inside',
      );
      expect(resolve(drag({ type: 'file', parentKey: 'p' }), target({ parentKey: 'p' }), 0.9)).toBe(
        'inside',
      );
    });

    it('keeps an inside target across parents', () => {
      expect(resolve(drag({ parentKey: 'a' }), target({ parentKey: 'b' }), 0.1)).toBe('inside');
      expect(resolve(drag({ parentKey: 'a' }), target({ parentKey: 'b' }), 0.9)).toBe('inside');
    });

    it('keeps an inside target outside a library', () => {
      expect(resolve(drag({ parentKey: 'p' }), target({ parentKey: 'p' }), 0.1, null)).toBe(
        'inside',
      );
    });
  });

  describe('file targets', () => {
    it('splits a sibling file drag at the row midpoint', () => {
      expect(
        resolve(
          drag({ type: 'file', parentKey: 'p' }),
          target({ isFolder: false, parentKey: 'p' }),
          0.49,
        ),
      ).toBe('before');
      expect(
        resolve(
          drag({ type: 'file', parentKey: 'p' }),
          target({ isFolder: false, parentKey: 'p' }),
          0.5,
        ),
      ).toBe('after');
    });

    it('rejects file targets across parents or outside a library', () => {
      expect(
        resolve(
          drag({ type: 'file', parentKey: 'a' }),
          target({ isFolder: false, parentKey: 'b' }),
          0.5,
        ),
      ).toBeNull();
      expect(
        resolve(
          drag({ type: 'file', parentKey: 'p' }),
          target({ isFolder: false, parentKey: 'p' }),
          0.5,
          null,
        ),
      ).toBeNull();
    });

    it('rejects a folder dragged over a file', () => {
      expect(
        resolve(
          drag({ type: 'folder', parentKey: 'p' }),
          target({ isFolder: false, parentKey: 'p' }),
          0.1,
        ),
      ).toBeNull();
    });
  });
});
