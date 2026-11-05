import { EditorRuntime } from '@lobechat/editor-runtime';
import type { IEditor } from '@lobehub/editor';
import {
  CommonPlugin,
  DiffAction,
  Kernel,
  LitexmlPlugin,
  MarkdownPlugin,
  moment,
} from '@lobehub/editor';
import { $getSelection } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveAllDiffs } from './resolveAllDiffs';

const mountPageWithPendingInsert = async () => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);

  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin, MarkdownPlugin, LitexmlPlugin]);
  editor.setRootElement(root);
  editor.setDocument('markdown', 'first\n\nsecond\n\nthird');
  await moment();

  const runtime = new EditorRuntime();
  runtime.setEditor(editor);
  runtime.setTitleHandlers(
    () => {},
    () => 'Title',
  );
  const xml = editor.getDocument('litexml') as unknown as string;
  const firstId = xml.match(/<p id="([^"]+)"/)![1];
  await runtime.modifyNodes({
    operations: [{ action: 'insert', afterId: firstId, litexml: '<p>added</p>' }],
  });
  await moment();

  return { editor, root };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveAllDiffs', () => {
  it.each([DiffAction.Accept, DiffAction.Reject])(
    'leaves the caret off the document end after action %s',
    async (action) => {
      const { editor, root } = await mountPageWithPendingInsert();
      expect(root.querySelector('[data-diff-type]')).not.toBeNull();

      resolveAllDiffs(editor, action);
      await moment();

      expect(root.querySelector('[data-diff-type]')).toBeNull();
      const selection = editor
        .getLexicalEditor()!
        .getEditorState()
        .read(() => $getSelection());
      expect(selection).toBeNull();
      const domSelection = window.getSelection();
      const anchor = domSelection?.rangeCount ? domSelection.anchorNode : null;
      expect(anchor && root.lastElementChild?.contains(anchor)).toBeFalsy();
    },
  );
});
