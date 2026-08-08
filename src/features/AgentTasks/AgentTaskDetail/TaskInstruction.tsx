import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { Paperclip } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CollapsibleContent from '@/components/CollapsibleContent';
import { EditingIndicator, type EditLockClient, useEditLock } from '@/features/EditLock';
import { EditorCanvas } from '@/features/EditorCanvas';
import { seedAttachments } from '@/features/EditorCanvas/attachmentRegistry';
import { pickAndInsertAttachments } from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { useTaskInstructionAutosave } from './useTaskInstructionAutosave';

// Stable lock RPC binding for the task resource.
const taskLockClient: EditLockClient = {
  acquire: (id) => lambdaClient.task.acquireTaskLock.mutate({ id }),
  peek: (id) => lambdaClient.task.getTaskLock.query({ id }),
  release: async (id) => {
    await lambdaClient.task.releaseTaskLock.mutate({ id });
  },
};

// Roomier than the chat-bubble default: the instruction is the primary content
// of the page, so the preview should carry a paragraph or two before it clamps.
const INSTRUCTION_MAX_HEIGHT = 320;

const TaskInstruction = memo(() => {
  const { t } = useTranslation('chat');
  const { allowed: canEditTask } = usePermission('create_content');
  const instruction = useTaskStore(taskDetailSelectors.activeTaskInstruction);
  const instructionRevision = useTaskStore(taskDetailSelectors.activeTaskInstructionRevision);
  const persistedEditorData = useTaskStore(taskDetailSelectors.activeTaskEditorData);
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskWorkspaceId = useTaskStore(taskDetailSelectors.activeTaskWorkspaceId);
  const persistedFiles = useTaskStore(taskDetailSelectors.activeTaskFiles);
  const updateTask = useTaskStore((s) => s.updateTask);
  const editor = useEditor();

  // Collaborative edit lock for workspace tasks (same model as pages): read-only
  // when another member is editing; acquired implicitly on the first edit.
  const [edited, setEdited] = useState(false);
  // A long instruction opens clamped so the properties, subtasks and activity
  // below it stay reachable; a short one never collapses and stays directly
  // editable. Both reset per task — the next task gets its own first read.
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const taskIdRef = useRef(taskId);
  if (taskIdRef.current !== taskId) {
    taskIdRef.current = taskId;
    setEdited(false);
    setExpanded(false);
  }
  const lock = useEditLock({
    client: taskLockClient,
    // Only workspace tasks lock — personal (non-workspace) tasks stay fully
    // editable with no peek/pending, matching the server's workspace gating.
    enabled: Boolean(taskId && canEditTask && taskWorkspaceId),
    isDirty: edited,
    resourceId: taskId ?? undefined,
  });
  // Read-only until the lock resolves, so the user can't start typing on a task
  // that turns out to be locked and get bounced mid-edit.
  const editable = canEditTask && !lock.lockedByOther && !lock.pending;

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

  const handleEdit = useCallback(() => setEdited(true), []);
  const handleContentChange = useTaskInstructionAutosave({
    contentRevision: instructionRevision,
    editable,
    editor,
    onEdit: handleEdit,
    taskId,
    updateTask,
  });

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  // Clicking into the clamped text focuses the editor, so expanding on focus
  // makes one click both open the instruction and land the caret where it was
  // aimed — no "expand, then click again to type".
  const handleFocus = useCallback(() => setExpanded(true), []);

  const handleCollapsedChange = useCallback(
    (collapsed: boolean) => {
      // Collapsing while the editor still holds the caret would let Lexical
      // restore focus and immediately re-expand.
      if (collapsed) editor?.blur();
      setExpanded(!collapsed);
    },
    [editor],
  );

  // Attaching a file only makes sense once the whole instruction is in view;
  // while clamped, the collapse toggle is the single affordance below the text.
  const showAttach = !overflowing || expanded;

  return (
    <Flexbox gap={4}>
      <EditingIndicator
        holderId={lock.lockedByOther ? lock.holderId : null}
        pending={canEditTask && lock.pending}
      />
      {/* editTask can update this mounted editor. The store revision changes only for external
          snapshots, so local autosave echoes and unchanged polling snapshots do not reload live
          input. Collapsing is pure CSS around the same mounted editor — never a remount, which
          would drop unsaved input. */}
      <CollapsibleContent
        collapsed={!expanded}
        maxHeight={INSTRUCTION_MAX_HEIGHT}
        onCollapsedChange={handleCollapsedChange}
        onOverflowChange={setOverflowing}
      >
        <div onFocus={handleFocus}>
          <EditorCanvas
            contentRevision={instructionRevision}
            disabled={!canEditTask}
            editable={!lock.lockedByOther && !lock.pending}
            editor={editor}
            editorData={editorData}
            entityId={taskId}
            placeholder={t('taskDetail.instructionPlaceholder')}
            onContentChange={handleContentChange}
          />
        </div>
      </CollapsibleContent>
      {showAttach && (
        <ActionIcon
          icon={Paperclip}
          size={'small'}
          title={t('upload.action.tooltip')}
          onClick={handleAttach}
        />
      )}
    </Flexbox>
  );
});

export default TaskInstruction;
