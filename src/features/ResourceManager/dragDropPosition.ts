/**
 * Where a dragged row should land relative to the row under the pointer.
 *
 * `null` means the row is not a valid drop target for this drag. The same
 * helper drives both the live hover indicator and the document-level drop
 * handler so the line the user sees is exactly where the row lands.
 */
export type DropPosition = 'before' | 'inside' | 'after' | null;

export type DragItemKind = 'file' | 'folder';

/** The row being dragged, as recorded in `DndContextWrapper`. */
export interface DragItem {
  id: string;
  parentKey?: string | null;
  type: DragItemKind;
}

/** The row (or folder drop zone) under the pointer. */
export interface DropTarget {
  id: string;
  isFolder: boolean;
  parentKey?: string | null;
}

/** `null`, `undefined` and `''` all address the library root. */
export const normalizeParentKey = (parentKey?: string | null): string => parentKey ?? '';

/** Fraction of the row's height the pointer sits at, clamped to 0..1. */
export const getRelativeY = (clientY: number, rect: Pick<DOMRect, 'top' | 'height'>): number => {
  if (rect.height <= 0) return 0.5;

  return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
};

interface ResolveDropPositionParams {
  /** Flat search results accept folder moves, never sibling insertion. */
  allowReorder?: boolean;
  drag: DragItem;
  /** Sibling reordering only exists inside a library. */
  libraryId?: string | null;
  /** Pointer position as a 0..1 fraction of the target row's height. */
  relY: number;
  target: DropTarget;
}

/**
 * Resolve the hit zone for a hovered row.
 *
 * Reordering only makes sense between rows of the same parent and type, so
 * those are the only cases that produce `'before'`/`'after'`. Everything else
 * falls back to the legacy folder semantics: a folder accepts the drag on its
 * whole row (`'inside'`), and a file/page rejects it.
 */
export const resolveDropPosition = ({
  allowReorder = true,
  drag,
  target,
  relY,
  libraryId,
}: ResolveDropPositionParams): DropPosition => {
  if (target.id === drag.id) return null;

  const sameParent = normalizeParentKey(drag.parentKey) === normalizeParentKey(target.parentKey);
  const canReorder = allowReorder && Boolean(libraryId) && sameParent;

  if (target.isFolder) {
    // A folder dragged over a sibling folder splits into before / inside /
    // after, keeping the folder-first rule while allowing custom order.
    if (canReorder && drag.type === 'folder') {
      if (relY < 0.25) return 'before';
      if (relY > 0.75) return 'after';

      return 'inside';
    }

    // Files (and cross-parent drags) still drop into the folder on any row.
    return 'inside';
  }

  if (canReorder && drag.type === 'file') {
    return relY < 0.5 ? 'before' : 'after';
  }

  return null;
};
