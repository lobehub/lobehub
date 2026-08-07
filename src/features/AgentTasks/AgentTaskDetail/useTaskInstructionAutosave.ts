import type { IEditor } from '@lobehub/editor';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import type { TaskStore } from '@/store/task';
import { useTaskStore } from '@/store/task';

const DEBOUNCE_MS = 300;

interface UseTaskInstructionAutosaveOptions {
  contentRevision: number;
  editable: boolean;
  editor: IEditor | undefined;
  onEdit: () => void;
  taskId?: string;
  updateTask: TaskStore['updateTask'];
}

export const useTaskInstructionAutosave = ({
  contentRevision,
  editable,
  editor,
  onEdit,
  taskId,
  updateTask,
}: UseTaskInstructionAutosaveOptions) => {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSavedJsonRef = useRef<string | undefined>(undefined);
  const lastContentRevisionRef = useRef(contentRevision);

  const cancelPendingSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
  }, []);

  useEffect(() => {
    lastSavedJsonRef.current = undefined;
    return cancelPendingSave;
  }, [cancelPendingSave, taskId]);

  // Cancel the local debounce before EditorDataMode applies the corresponding
  // external snapshot in its passive effect. Otherwise the stale timer could
  // write the pre-tool document back over the authoritative editTask result.
  useLayoutEffect(() => {
    if (lastContentRevisionRef.current === contentRevision) return;
    lastContentRevisionRef.current = contentRevision;
    cancelPendingSave();
    lastSavedJsonRef.current = undefined;
  }, [cancelPendingSave, contentRevision]);

  return useCallback(() => {
    if (!editable || !editor || !taskId) return;

    onEdit();
    cancelPendingSave();
    const scheduledContentRevision = contentRevision;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;

      /**
       * editTask updates the Store revision synchronously, but React may not
       * have committed the layout effect that cancels this timer yet. Checking
       * the Store closes that dispatch-to-commit window before reading or
       * persisting the stale editor document.
       */
      const currentContentRevision =
        useTaskStore.getState().taskInstructionRevisionMap[taskId] ?? 0;
      if (currentContentRevision !== scheduledContentRevision) return;

      const json = editor.getDocument('json') as unknown;
      const jsonSignature = JSON.stringify(json);
      if (jsonSignature === lastSavedJsonRef.current) return;
      lastSavedJsonRef.current = jsonSignature;

      const markdown = String(editor.getDocument('markdown') ?? '');
      updateTask(taskId, { editorData: json, instruction: markdown }, { source: 'editor' }).catch(
        (error) => {
          console.error('[TaskInstruction] Failed to save:', error);
        },
      );
    }, DEBOUNCE_MS);
  }, [cancelPendingSave, contentRevision, editable, editor, onEdit, taskId, updateTask]);
};
