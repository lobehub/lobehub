'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronUp, Paperclip, UserCircle2 } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { message } from '@/components/AntdStaticMethods';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';

interface CreateTaskInlineEntryProps {
  agentId?: string;
  autoFocus?: boolean;
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCollapse?: () => void;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  parentTaskId?: string;
  placeholder?: string;
  /**
   * `hero` adapts the entry for the empty-tasks landing: hides collapse,
   * enlarges the editor area, and forces autoFocus.
   */
  variant?: 'default' | 'hero';
}

const CreateTaskInlineEntry = memo<CreateTaskInlineEntryProps>((props) => {
  const {
    agentId,
    autoFocus,
    lockAssignee,
    onCollapse,
    onCreated,
    parentTaskId,
    placeholder,
    variant = 'default',
  } = props;
  const isHero = variant === 'hero';
  const { t } = useTranslation('chat');
  const { allowed: canCreateTask, reason } = usePermission('create_content');

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const activeWorkspaceId = useActiveWorkspaceId();
  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [instruction, setInstruction] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);
  // Default to private in workspace mode so the user has to opt in to share.
  // In personal mode the chip is hidden and the value is never sent.
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');

  // A private agent can only run a private task. Coerce + lock the
  // visibility chip when the selected agent is private.
  const assigneeVisibility = useAgentVisibility(assigneeAgentId);
  const isPrivateAgent = assigneeVisibility === 'private';
  useEffect(() => {
    if (isPrivateAgent && visibility === 'public') setVisibility('private');
  }, [isPrivateAgent, visibility]);

  const editor = useEditor();

  // Persist the in-progress draft per scope so a reload / accidental close
  // doesn't eat a long prompt. Skipped for the transient subtask composer.
  const draftStorageKey = useMemo(
    () => (parentTaskId ? null : `lobehub:task-create-draft:${agentId ?? 'all'}`),
    [agentId, parentTaskId],
  );
  // Tracks which scope key the editor is currently hydrated for. The component
  // is reused across /agent/A/tasks -> /agent/B/tasks -> /tasks without
  // unmounting, so a boolean would strand the new scope on the old draft.
  const draftRestoredKeyRef = useRef<string | null>(null);

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

  // When the assignee is locked to a scoped agent, keep it in sync with the
  // `agentId` prop. The route subtree is reused across /agent/A/tasks ->
  // /agent/B/tasks and /agent/A/tasks -> /tasks, so without this the hidden
  // assignee would stay on the previous scoped agent.
  useEffect(() => {
    if (lockAssignee) {
      setAssigneeAgentId(agentId);
      return;
    }

    if (!agentId) setAssigneeAgentId(undefined);
  }, [agentId, lockAssignee]);

  useEffect(() => {
    if (!canCreateTask) return;
    if (autoFocus || isHero) editor?.focus?.();
  }, [autoFocus, canCreateTask, editor, isHero]);

  // Hydrate the editor with the current scope's saved draft. Re-runs whenever
  // the scope key changes (not just on mount): it first resets to this scope's
  // baseline so a previous scope's draft can't leak across a switch, then loads
  // the new key's draft. The editor's onContentChange syncs `instruction`.
  useEffect(() => {
    if (!draftStorageKey || !editor) return;
    if (draftRestoredKeyRef.current === draftStorageKey) return;
    draftRestoredKeyRef.current = draftStorageKey;

    // Reset to baseline for the new scope before hydrating.
    editor.cleanDocument?.();
    setPriority(0);
    setVisibility('private');
    if (!lockAssignee) setAssigneeAgentId(agentId);

    let raw: string | null;
    try {
      raw = localStorage.getItem(draftStorageKey);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        assigneeAgentId?: string;
        markdown?: string;
        priority?: number;
        visibility?: 'private' | 'public';
      };
      if (draft.markdown) editor.setDocument?.('markdown', draft.markdown);
      if (typeof draft.priority === 'number') setPriority(draft.priority);
      if (!lockAssignee && draft.assigneeAgentId) setAssigneeAgentId(draft.assigneeAgentId);
      if (draft.visibility) setVisibility(draft.visibility);
    } catch {
      /* ignore a malformed draft */
    }
  }, [agentId, draftStorageKey, editor, lockAssignee]);

  // Back the draft to storage on every change. Gated behind the restore pass so
  // the initial render can't clobber a just-read draft. Write-only on non-empty:
  // the key is cleared only on a successful submit (below), never here — so a
  // `setDocument`-timing gap right after restore can't wipe a valid draft.
  useEffect(() => {
    if (!draftStorageKey || draftRestoredKeyRef.current !== draftStorageKey || !editor) return;
    const markdown = String(editor.getDocument?.('markdown') ?? '').trim();
    if (!markdown) return;
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          assigneeAgentId: lockAssignee ? undefined : assigneeAgentId,
          markdown,
          priority,
          visibility,
        }),
      );
    } catch {
      /* storage unavailable / quota — persistence is best-effort */
    }
  }, [assigneeAgentId, draftStorageKey, editor, instruction, lockAssignee, priority, visibility]);

  const handleCollapse = useCallback(() => {
    if (onCollapse) {
      onCollapse();
      return;
    }
    updateSystemStatus({ taskCreateInlineCollapsed: true }, 'collapseTaskCreateInline');
  }, [onCollapse, updateSystemStatus]);

  const handleContentChange = useCallback(() => {
    if (!canCreateTask) return;
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      setInstruction($getRoot().getTextContent());
    });
    setHasAttachments(getAttachmentFileIdsFromEditor(editor).length > 0);
  }, [canCreateTask, editor]);

  const handleAttach = useCallback(() => {
    pickAndInsertAttachments(editor);
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!canCreateTask) return;
    const markdown = String(editor?.getDocument?.('markdown') ?? '').trim();
    const trimmedText = instruction.trim();
    const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
    if (!trimmedText && !markdown && !hasFiles) return;

    const firstLine =
      trimmedText
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? trimmedText;
    let name: string | undefined;
    if (firstLine) {
      name = firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine;
    }

    const editorJson = editor?.getDocument?.('json') as unknown;

    // `createTask` keeps its rejecting contract (other callers rely on `catch`);
    // handle the composer's own failure here so it isn't silent, keeping the
    // draft intact (the reset only runs on success).
    try {
      const result = await createTask({
        assigneeAgentId,
        editorData: editorJson,
        instruction: markdown || trimmedText || name || '',
        name,
        parentTaskId,
        priority: priority || undefined,
        // Only send visibility in workspace mode; personal mode lets the server
        // fall through to the schema default ('public', inert in personal mode).
        visibility: activeWorkspaceId ? visibility : undefined,
      });

      if (result) {
        setPriority(0);
        setAssigneeAgentId(agentId);
        setInstruction('');
        setVisibility('private');
        editor?.cleanDocument?.();
        if (draftStorageKey) {
          try {
            localStorage.removeItem(draftStorageKey);
          } catch {
            /* ignore */
          }
        }
        onCreated?.({
          agentId: result.assigneeAgentId ?? undefined,
          identifier: result.identifier,
        });
      }
    } catch {
      message.error(t('createTask.createFailed'));
    }
  }, [
    t,
    activeWorkspaceId,
    agentId,
    assigneeAgentId,
    createTask,
    draftStorageKey,
    editor,
    instruction,
    onCreated,
    parentTaskId,
    priority,
    canCreateTask,
    visibility,
  ]);

  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitRef.current?.();
    }
  }, []);

  return (
    <Block
      style={{ overflow: 'hidden', position: 'relative' }}
      variant={'outlined'}
      onKeyDownCapture={handleKeyDown}
    >
      {!isHero && (
        <ActionIcon
          icon={ChevronUp}
          size={'small'}
          style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
          title={t('createTask.collapse')}
          onClick={handleCollapse}
        />
      )}
      <Flexbox
        style={{
          fontSize: isHero ? 16 : 14,
          // Cap the editor so a long draft scrolls inside the box instead of
          // growing the composer until it pushes the task list below the fold.
          maxHeight: isHero ? 360 : 200,
          overflowY: 'auto',
          padding: isHero ? '12px 16px 0' : '8px 40px 0 16px',
        }}
      >
        <EditorCanvas
          disabled={!canCreateTask}
          editor={editor}
          floatingToolbar={false}
          placeholder={placeholder ?? t('createTask.instructionPlaceholder')}
          style={{
            fontSize: isHero ? 16 : 14,
            minHeight: isHero ? 80 : undefined,
            paddingBottom: 12,
          }}
          onContentChange={handleContentChange}
        />
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        justify={'space-between'}
        style={{
          borderTop: `1px solid ${cssVar.colorBorderSecondary}`,
          paddingBlock: 8,
          paddingInline: '8px 16px',
        }}
      >
        <Flexbox horizontal align={'center'} gap={2} wrap={'wrap'}>
          <TaskPriorityTag priority={priority} onChange={setPriority}>
            <Block
              clickable
              horizontal
              align="center"
              gap={6}
              height={24}
              paddingBlock={3}
              paddingInline={8}
              variant={'borderless'}
            >
              <TaskPriorityTag disableDropdown priority={priority} size={14} />
              <Text fontSize={12}>
                {priority === 0
                  ? t('taskDetail.priority.none')
                  : t(
                      `taskDetail.priority.${(['', 'urgent', 'high', 'normal', 'low'] as const)[priority]}` as never,
                    )}
              </Text>
            </Block>
          </TaskPriorityTag>

          {(() => {
            const assigneeChip = (
              <Block
                horizontal
                align="center"
                clickable={!lockAssignee}
                gap={6}
                height={24}
                paddingBlock={3}
                paddingInline={8}
                variant={'borderless'}
              >
                {assigneeAgentId ? (
                  <>
                    <AssigneeAvatar agentId={assigneeAgentId} size={18} />
                    <Text fontSize={12}>{assigneeMeta?.title}</Text>
                  </>
                ) : (
                  <>
                    <Icon color={cssVar.colorTextDescription} icon={UserCircle2} size={14} />
                    <Text color={cssVar.colorTextDescription} fontSize={12}>
                      {t('createTask.assignee')}
                    </Text>
                  </>
                )}
              </Block>
            );

            return lockAssignee ? (
              assigneeChip
            ) : (
              <AssigneeAgentSelector currentAgentId={assigneeAgentId} onChange={setAssigneeAgentId}>
                {assigneeChip}
              </AssigneeAgentSelector>
            );
          })()}

          <ActionIcon
            icon={Paperclip}
            size={'small'}
            title={t('upload.action.tooltip')}
            onClick={handleAttach}
          />
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={4}>
          {activeWorkspaceId && (
            <TaskVisibilityTag
              visibility={visibility}
              lockedReason={
                isPrivateAgent
                  ? t('createTask.visibility.privateAgentLocked', {
                      defaultValue: 'Private agents can only run private tasks.',
                    })
                  : undefined
              }
              onChange={setVisibility}
            >
              <TaskVisibilityChipLabel height={24} paddingBlock={3} visibility={visibility} />
            </TaskVisibilityTag>
          )}

          <Button
            disabled={!canCreateTask || isCreating || (!instruction.trim() && !hasAttachments)}
            loading={isCreating}
            shape={'round'}
            size={'small'}
            title={canCreateTask ? undefined : reason}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t('createTask.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

export default CreateTaskInlineEntry;
