import {
  captureCollaborativeRewriteSelection,
  type CapturedCollaborativeRewriteSelection,
  HIDE_TOOLBAR_COMMAND,
  type IEditor,
} from '@lobehub/editor';

type CaptureSelection = typeof captureCollaborativeRewriteSelection;

export interface RewriteToolbarClickEvent {
  detail?: number;
}

export interface RewriteToolbarClickInput {
  capture?: CaptureSelection;
  documentId: string;
  editor: IEditor;
  event?: RewriteToolbarClickEvent;
  onSelection: (selection: CapturedCollaborativeRewriteSelection) => void;
  onUnavailable?: () => void;
  /** Page rewrites require a Yjs-relative selection with a room namespace. */
  requireRelative?: boolean;
}

export interface RewriteToolbarVisibilityInput {
  collaborationEnabled: boolean;
  documentId?: string;
  effectiveEditable: boolean;
  onRewriteSelection?: (selection: CapturedCollaborativeRewriteSelection) => void;
}

export const shouldRenderRewriteToolbarItem = ({
  collaborationEnabled,
  documentId,
  effectiveEditable,
  onRewriteSelection,
}: RewriteToolbarVisibilityInput): boolean =>
  Boolean(onRewriteSelection && documentId && collaborationEnabled && effectiveEditable);

/**
 * Capture the collaborative selection at the action click. The floating
 * toolbar owns the browser selection lifecycle; keeping this operation on
 * click preserves its native pointer and keyboard behavior.
 */
export const handleRewriteToolbarClick = ({
  capture = captureCollaborativeRewriteSelection,
  documentId,
  editor,
  event: _event,
  requireRelative = false,
  onSelection,
  onUnavailable,
}: RewriteToolbarClickInput): boolean => {
  const selection = capture(editor, { roomId: documentId });
  if (!selection || (requireRelative && (selection.kind !== 'relative' || !selection.roomId))) {
    onUnavailable?.();
    return false;
  }

  editor.dispatchCommand(HIDE_TOOLBAR_COMMAND, undefined);
  editor.blur();
  onSelection(selection);
  return true;
};
