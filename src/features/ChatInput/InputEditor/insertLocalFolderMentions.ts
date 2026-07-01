import type { IEditor } from '@lobehub/editor';

import type { DroppedFolder } from '@/components/DragUploadZone';

import { INSERT_LOCAL_FILE_MENTION_COMMAND } from './LocalFileMention';

/**
 * Insert one LocalFileMention node per dropped folder at the editor's current
 * selection. Each insert appends a trailing space (handled by the command) so
 * consecutive mentions read as distinct tokens and the user can keep typing.
 *
 * Shares the LocalFileMention node with the `@`-menu and the working-sidebar
 * drag path, so every local-file reference renders as the same compact
 * icon + name chip and serializes to `<localFile name="…" path="…" isDirectory />`.
 */
export const insertLocalFolderMentions = (editor: IEditor, folders: DroppedFolder[]) => {
  if (folders.length === 0) return;

  const lexicalEditor = editor.getLexicalEditor();
  lexicalEditor?.focus();

  folders.forEach((folder) => {
    editor.dispatchCommand(INSERT_LOCAL_FILE_MENTION_COMMAND, {
      isDirectory: true,
      name: folder.name,
      path: folder.path,
    });
  });
};
