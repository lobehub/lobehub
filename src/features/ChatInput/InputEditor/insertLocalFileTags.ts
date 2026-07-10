import type { IEditor } from '@lobehub/editor';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';

import type { DroppedLocalPath } from '@/components/DragUploadZone';

import { INSERT_LOCAL_FILE_TAG_COMMAND } from './LocalFileTag';

const ensureRangeSelection = (editor: IEditor) => {
  const lexicalEditor = editor.getLexicalEditor();
  lexicalEditor?.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      $getRoot().selectEnd();
    }
  });
};

/**
 * Insert one LocalFileTag node per local path at the editor's current selection.
 * The command appends a trailing space for each tag so the user can keep typing.
 */
export const insertLocalPathTags = (editor: IEditor, paths: DroppedLocalPath[]) => {
  if (paths.length === 0) return;

  const lexicalEditor = editor.getLexicalEditor();
  lexicalEditor?.focus();
  ensureRangeSelection(editor);

  paths.forEach((item) => {
    editor.dispatchCommand(INSERT_LOCAL_FILE_TAG_COMMAND, {
      isDirectory: item.isDirectory,
      name: item.name,
      path: item.path,
    });
  });
};
