import { useEditor } from '@lobehub/editor/react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const DEBOUNCE_MS = 300;

const TaskInstruction = memo(() => {
  const { t } = useTranslation('chat');
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const updateTask = useTaskStore((s) => s.updateTask);
  const editor = useEditor();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const editorData = useMemo(() => ({ content: instruction ?? '' }), [instruction]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [taskId]);

  const handleContentChange = useCallback(() => {
    if (!editor || !taskId) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const markdown = String(editor.getDocument('markdown') ?? '');
      updateTask(taskId, { instruction: markdown }).catch((e) => {
        console.error('[TaskInstruction] Failed to save:', e);
      });
    }, DEBOUNCE_MS);
  }, [editor, taskId, updateTask]);

  return (
    <EditorCanvas
      editor={editor}
      editorData={editorData}
      entityId={taskId}
      placeholder={t('taskDetail.instructionPlaceholder')}
      onContentChange={handleContentChange}
    />
  );
});

export default TaskInstruction;
