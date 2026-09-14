import { HIDE_TOOLBAR_COMMAND, type IEditor } from '@lobehub/editor';
import { describe, expect, it, vi } from 'vitest';

import { handleRewriteToolbarClick, shouldRenderRewriteToolbarItem } from './rewriteToolbar';

const relativeSelection = {
  anchorPos: { assoc: 0 },
  baseStateVector: 'AQ==',
  capturedAt: '2026-08-29T00:00:00.000Z',
  endNodeId: 'node-b',
  endOffset: 5,
  focusPos: { assoc: 0 },
  kind: 'relative' as const,
  quotedText: 'Selected',
  quotedTextHash: 'fnv1a-test',
  roomId: 'page-1',
  startNodeId: 'node-a',
  startOffset: 0,
  targetNodeIds: ['node-a', 'node-b'],
};

const createEditor = (): IEditor =>
  ({
    blur: vi.fn(),
    dispatchCommand: vi.fn(() => true),
  }) as unknown as IEditor;

describe('shouldRenderRewriteToolbarItem', () => {
  it('requires a ready collaboration provider and an editable document', () => {
    const onRewriteSelection = vi.fn();
    const base = {
      documentId: 'page-1',
      effectiveEditable: true,
      onRewriteSelection,
    };

    expect(shouldRenderRewriteToolbarItem({ ...base, collaborationEnabled: true })).toBe(true);
    expect(shouldRenderRewriteToolbarItem({ ...base, collaborationEnabled: false })).toBe(false);
    expect(
      shouldRenderRewriteToolbarItem({
        ...base,
        collaborationEnabled: true,
        effectiveEditable: false,
      }),
    ).toBe(false);
    expect(
      shouldRenderRewriteToolbarItem({
        ...base,
        collaborationEnabled: true,
        documentId: undefined,
      }),
    ).toBe(false);
  });
});

describe('handleRewriteToolbarClick', () => {
  it('captures the current selection on click and then hides the toolbar', () => {
    const callOrder: string[] = [];
    const editor = {
      blur: vi.fn(() => {
        callOrder.push('blur');
      }),
      dispatchCommand: vi.fn(() => {
        callOrder.push('hide');
        return true;
      }),
    } as unknown as IEditor;
    const capture = vi.fn(() => relativeSelection);
    const onSelection = vi.fn((selection) => {
      expect(callOrder).toEqual(['hide', 'blur']);
      callOrder.push('selection');
      expect(selection).toBe(relativeSelection);
    });

    expect(
      handleRewriteToolbarClick({
        capture,
        documentId: 'page-1',
        editor,
        onSelection,
        requireRelative: true,
      }),
    ).toBe(true);
    expect(capture).toHaveBeenCalledWith(editor, { roomId: 'page-1' });
    expect(onSelection).toHaveBeenCalledWith(relativeSelection);
    expect(editor.dispatchCommand).toHaveBeenCalledWith(HIDE_TOOLBAR_COMMAND, undefined);
    expect(editor.blur).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['hide', 'blur', 'selection']);
    expect(relativeSelection).toMatchObject({
      endNodeId: 'node-b',
      quotedText: 'Selected',
      startNodeId: 'node-a',
    });
  });

  it('does not submit when the click has no usable collaborative selection', () => {
    const editor = createEditor();
    const onSelection = vi.fn();
    const onUnavailable = vi.fn();

    expect(
      handleRewriteToolbarClick({
        capture: () => null,
        documentId: 'page-1',
        editor,
        onSelection,
        onUnavailable,
        requireRelative: true,
      }),
    ).toBe(false);
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onSelection).not.toHaveBeenCalled();
    expect(editor.dispatchCommand).not.toHaveBeenCalled();
    expect(editor.blur).not.toHaveBeenCalled();
  });

  it('rejects a block fallback when Page rewrites require relative positions', () => {
    const editor = createEditor();
    const onSelection = vi.fn();
    const onUnavailable = vi.fn();
    const blockSelection = {
      endNodeId: 'node-b',
      endOffset: 5,
      kind: 'block' as const,
      quotedText: 'Selected',
      quotedTextHash: 'fnv1a-test',
      startNodeId: 'node-a',
      startOffset: 0,
      targetNodeIds: ['node-a', 'node-b'],
    };

    expect(
      handleRewriteToolbarClick({
        capture: () => blockSelection,
        documentId: 'page-1',
        editor,
        onSelection,
        onUnavailable,
        requireRelative: true,
      }),
    ).toBe(false);
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onSelection).not.toHaveBeenCalled();
  });
});
