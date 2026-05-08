import type { ChatPanelSelection } from './ChatPanel';
import type { Rect } from './useDockPosition';

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
