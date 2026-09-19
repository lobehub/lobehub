import type { ChatPanelSelection } from './ChatPanel';
import type { Rect } from './useDockPosition';

export type OverlayMode = 'capture' | 'compose';

/** Esc backs out of an empty capture pass before it closes the composer. */
export const resolveEscapeAction = ({
  mode,
  selectionCount,
}: {
  mode: OverlayMode;
  selectionCount: number;
}): 'close' | 'exitCapture' =>
  mode === 'capture' && selectionCount === 0 ? 'exitCapture' : 'close';

export const resolveCommittedSelectionRect = ({
  pendingSelectionRect,
  selection,
}: {
  pendingSelectionRect: Rect | null;
  selection: ChatPanelSelection | null;
}): Rect | null => selection?.rect ?? pendingSelectionRect;

export const shouldHideChatPanel = ({
  isPreviewingSelection,
  isSelecting,
}: {
  isPreviewingSelection: boolean;
  isSelecting: boolean;
}): boolean => isSelecting || isPreviewingSelection;
