import type { IEditor } from '@lobehub/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

import { DICTATION_UPDATE_TAG, LexicalDictationEditor } from './editor';

const createFixture = () => {
  const lexicalEditor = createEditor({ namespace: 'dictation-test' });
  lexicalEditor.update(
    () => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode('draft tail');
      paragraph.append(text);
      $getRoot().append(paragraph);
      text.select(6, 6);
    },
    { discrete: true },
  );
  const editor = {
    getLexicalEditor: () => lexicalEditor,
  } as unknown as IEditor;
  return { adapter: new LexicalDictationEditor(editor), lexicalEditor };
};

const readText = (editor: ReturnType<typeof createEditor>) =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

describe('LexicalDictationEditor', () => {
  it('inserts at the cursor, replaces only the dictation segment, and preserves the draft suffix', () => {
    const { adapter, lexicalEditor } = createFixture();
    const attachmentDraft = [{ id: 'attachment-1', name: 'brief.pdf' }];
    const snapshot = adapter.begin(vi.fn());

    expect(snapshot).toEqual({ anchor: 6, prefix: 'draft ', suffix: 'tail' });
    adapter.render('hel');
    expect(readText(lexicalEditor)).toBe('draft heltail');
    adapter.render('hello ');
    expect(readText(lexicalEditor)).toBe('draft hello tail');
    adapter.finalize('hello ');

    expect(readText(lexicalEditor)).toBe('draft hello tail');
    expect(attachmentDraft).toEqual([{ id: 'attachment-1', name: 'brief.pdf' }]);
    lexicalEditor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      expect(selection?.isCollapsed()).toBe(true);
    });
  });

  it('does not replace a selected draft range when dictation begins', () => {
    const { adapter, lexicalEditor } = createFixture();
    lexicalEditor.update(
      () => {
        const text = $getRoot().getFirstDescendant();
        if ($isTextNode(text)) text.select(0, 5);
      },
      { discrete: true },
    );

    adapter.begin(vi.fn());
    adapter.render('spoken ');

    expect(readText(lexicalEditor)).toBe('draftspoken  tail');
  });

  it('detects an untagged user edit but ignores dictation-tagged updates', () => {
    const { adapter, lexicalEditor } = createFixture();
    const onUserEdit = vi.fn();
    adapter.begin(onUserEdit);
    adapter.render('spoken');
    expect(onUserEdit).not.toHaveBeenCalled();

    lexicalEditor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if ($isElementNode(paragraph)) paragraph.append($createTextNode(' user edit'));
      },
      { discrete: true },
    );
    expect(onUserEdit).toHaveBeenCalledOnce();

    lexicalEditor.update(() => undefined, { discrete: true, tag: DICTATION_UPDATE_TAG });
    expect(onUserEdit).toHaveBeenCalledOnce();
  });

  it('does not steal a cursor that the user moved outside the dictation segment', () => {
    const { adapter, lexicalEditor } = createFixture();
    adapter.begin(vi.fn());
    adapter.render('spoken ');
    lexicalEditor.update(
      () => {
        const textNodes = $getRoot().getAllTextNodes();
        textNodes.at(-1)?.select(2, 2);
      },
      { discrete: true, tag: DICTATION_UPDATE_TAG },
    );

    adapter.render('confirmed ');
    adapter.finalize('confirmed ');
    lexicalEditor.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText('X');
      },
      { discrete: true },
    );

    expect(readText(lexicalEditor)).toBe('draft confirmed taXil');
  });
});
