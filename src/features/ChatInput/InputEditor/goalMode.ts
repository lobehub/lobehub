import type { IEditor } from '@lobehub/editor';

export const enterGoalMode = (
  editor: IEditor | undefined,
  setGoalMode: (enabled: boolean) => void,
  replaceSlashQuery = false,
) => {
  if (!editor) return;

  if (replaceSlashQuery) {
    editor.setDocument('markdown', '', { keepHistory: true });
  }
  setGoalMode(true);
  editor.focus();
};
