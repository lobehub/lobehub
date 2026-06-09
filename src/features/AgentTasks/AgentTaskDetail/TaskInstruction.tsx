import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { seedAttachments } from '@/features/EditorCanvas/attachmentRegistry';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const DEBOUNCE_MS = 300;

const TaskInstruction = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const persistedEditorData = useTaskStore(taskDetailSelectors.activeTaskEditorData);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const persistedFiles = useTaskStore(taskDetailSelectors.activeTaskFiles);
  const updateTask = useTaskStore((s) => s.updateTask);
  const editor = useEditor();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Skip save when the serialized state matches the last persisted snapshot —
  // Lexical fires content-change for selection moves and other no-op events.
  const lastSavedJsonRef = useRef<string | undefined>(undefined);

  const editorData = useMemo(
    () => ({
      content: instruction ?? '',
      editorData: persistedEditorData,
    }),
    [instruction, persistedEditorData],
  );

  useEffect(() => {
    if (persistedFiles && persistedFiles.length > 0) {
      seedAttachments(persistedFiles.map((f) => ({ id: f.id, url: f.url })));
    }
  }, [persistedFiles]);

  useEffect(() => {
    lastSavedJsonRef.current = undefined;
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [taskId]);

  const handleContentChange = useCallback(() => {
    if (!canEditTask) return;
    if (!editor || !taskId) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const json = editor.getDocument('json') as unknown;
      const jsonSignature = JSON.stringify(json);
      if (jsonSignature === lastSavedJsonRef.current) return;
      lastSavedJsonRef.current = jsonSignature;

      const markdown = String(editor.getDocument('markdown') ?? '');
      updateTask(taskId, { editorData: json, instruction: markdown }).catch((e) => {
        console.error('[TaskInstruction] Failed to save:', e);
      });
    }, DEBOUNCE_MS);
  }, [canEditTask, editor, taskId, updateTask]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  return (
    <Flexbox gap={4}>
      <EditorCanvas
        editor={editor}
        editorData={editorData}
        entityId={taskId}
        placeholder={t('taskDetail.instructionPlaceholder')}
        onContentChange={handleContentChange}
      />
      <ActionIcon
        icon={Paperclip}
        size={'small'}
        title={t('upload.action.tooltip')}
        onClick={handleAttach}
      />
    </Flexbox>
  );
});

export default TaskInstruction;
