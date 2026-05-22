import type { IEditor } from '@lobehub/editor';
import { INSERT_MENTION_COMMAND } from '@lobehub/editor';
import { $getSelection, $isRangeSelection } from 'lexical';

import type { DroppedFolder } from '@/components/DragUploadZone';

/**
 * Insert one localFile mention node per dropped folder at the editor's current
 * selection, separating consecutive mentions with a space so they read as
 * distinct tokens.
 *
 * Mirrors the metadata shape used by the `@`-menu local-file mention path so
 * the markdownWriter in InputEditor renders `<localFile name="..." path="..." isDirectory />`.
 */
export const insertLocalFolderMentions = (editor: IEditor, folders: DroppedFolder[]) => {
  if (folders.length === 0) return;

  const lexicalEditor = editor.getLexicalEditor();
  lexicalEditor?.focus();

  folders.forEach((folder, index) => {
    if (index > 0) {
      lexicalEditor?.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText(' ');
        }
      });
    }
    editor.dispatchCommand(INSERT_MENTION_COMMAND, {
      label: folder.name,
      metadata: {
        isDirectory: true,
        name: folder.name,
        path: folder.path,
        type: 'localFile',
      },
    });
  });

  // Trailing space so the user can keep typing without manually adding one.
  lexicalEditor?.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertText(' ');
    }
  });
};
