'use client';

import type { TaskExecutionConfig } from '@lobechat/types';
import { toTaskExecutionConfigPatch } from '@lobechat/types';
import { useEditor } from '@lobehub/editor/react';
import {
  ActionIcon,
  Block,
  Button,
  confirmModal,
  cssVar,
  Flexbox,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Minimize2, Paperclip, X } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { releaseEditorSelection } from '@/features/EditorCanvas/releaseEditorSelection';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskExecutionControls from '../features/TaskExecutionControls';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';
import { hasUnsavedTaskDraft } from './hasUnsavedTaskDraft';
import ScheduleChip from './ScheduleChip';
import {
  createDefaultScheduleDraft,
  type ScheduleDraft,
  toScheduledCreateParams,
} from './scheduleDraft';
import { useEscapeDiscardGuard } from './useEscapeDiscardGuard';
import { useTitleEnterToInstruction } from './useTitleEnterToInstruction';

export interface CreateTaskContentProps {
  agentId?: string;
  /** Initial priority, e.g. the Kanban priority column the modal was opened from. */
  defaultPriority?: number;
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCreated?: (task: { id: string; agentId?: string; identifier: string; name?: string }) => void;
  projectId?: string;
  /**
   * Creates a scheduled task: the form gains a schedule chip and the task is
   * created with that schedule already on. Used by the Scheduled tasks tab.
   */
  schedule?: boolean;
  /**
   * Whether to show the "minimize to inline entry" button. Only the list view has an
   * inline entry target, so contexts like the Kanban board pass `false` to hide it.
   */
  showInlineToggle?: boolean;
}

const CreateTaskContent = memo<CreateTaskContentProps>(
  ({
    agentId,
    defaultPriority = 0,
    lockAssignee,
    onCreated,
    projectId,
    schedule: isScheduled = false,
    showInlineToggle = true,
  }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const { allowed: canCreateTask, reason } = usePermission('create_content');

    const createTask = useTaskStore((s) => s.createTask);
    const isCreating = useTaskStore((s) => s.isCreatingTask);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

    const activeWorkspaceId = useActiveWorkspaceId();

    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState(defaultPriority);
    const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
    const [assigneeUserId, setAssigneeUserId] = useState<string | undefined>();
    // Where this task will run, if not simply wherever the assignee runs.
    // Undefined = inherit, and then nothing is sent, so an untouched modal
    // creates exactly the task it always did.
    const [execution, setExecution] = useState<TaskExecutionConfig | undefined>();
    // Default to workspace-visible: workspace tasks are team work by default,
    // and going private stays one click away. In personal mode the field is
    // irrelevant and the chip is hidden anyway.
    const [visibility, setVisibility] = useState<'private' | 'public'>('public');
    const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(createDefaultScheduleDraft);

    const assigneeVisibility = useAgentVisibility(assigneeAgentId);
    const isPrivateAgent = assigneeVisibility === 'private';
    const selfUserId = useUserStore(userProfileSelectors.userId);
    const isOtherMemberAssignee = Boolean(assigneeUserId) && assigneeUserId !== selfUserId;

    // Resolve the two visibility constraints in one place so an old draft or an
    // externally privatized agent cannot make separate effects toggle forever.
    // A private agent is the stronger constraint, so drop an incompatible member.
    useEffect(() => {
      if (isPrivateAgent) {
        if (isOtherMemberAssignee) setAssigneeUserId(undefined);
        if (visibility === 'public') setVisibility('private');
        return;
      }

      if (isOtherMemberAssignee && visibility === 'private') setVisibility('public');
    }, [isOtherMemberAssignee, isPrivateAgent, visibility]);

    const editor = useEditor();
    const instructionRef = useRef('');

    const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);
    const memberMeta = useUserDisplayMeta(assigneeUserId);

    const handleAgentChange = useCallback((nextAgentId: string | null) => {
      setAssigneeAgentId(nextAgentId ?? undefined);
      // The repo list belongs to the assignee (its provider env), so a
      // selection made for the previous agent must not carry over. A pinned
      // device is the user's machine and stays valid across agents.
      setExecution((current) =>
        current?.repos
          ? {
              ...current,
              repos: undefined,
              workingDirectory: undefined,
              workingDirectoryConfig: undefined,
            }
          : current,
      );
    }, []);
    const handleMemberChange = useCallback((nextUserId: string | null) => {
      setAssigneeUserId(nextUserId ?? undefined);
    }, []);

    const handleInline = useCallback(() => {
      updateSystemStatus({ taskCreateInlineCollapsed: false }, 'expandTaskCreateInline');
      close();
    }, [close, updateSystemStatus]);

    const handleContentChange = useCallback(() => {
      if (!canCreateTask) return;
      if (!editor) return;
      instructionRef.current = String(editor.getDocument('markdown') ?? '');
    }, [canCreateTask, editor]);

    const handleAttach = useCallback(() => {
      pickAndInsertAttachments(editor);
    }, [editor]);

    const handleSubmit = useCallback(async () => {
      if (!canCreateTask) return;
      const instruction = instructionRef.current.trim();
      const hasFiles = getAttachmentFileIdsFromEditor(editor).length > 0;
      if (!instruction && !title.trim() && !hasFiles) return;

      const editorJson = editor?.getDocument?.('json') as unknown;

      // Only present when the user pinned a run location / directory —
      // otherwise the task inherits the assignee agent entirely.
      const config = execution ? { execution: toTaskExecutionConfigPatch(execution) } : undefined;

      // `createTask` keeps its rejecting contract; surface the failure here so a
      // failed create isn't silent and the modal stays open with its content.
      try {
        const result = await createTask({
          assigneeAgentId,
          assigneeUserId,
          ...(isScheduled ? toScheduledCreateParams(scheduleDraft, config) : { config }),
          editorData: editorJson,
          instruction: instruction || title.trim(),
          name: title.trim() || undefined,
          priority: priority || undefined,
          projectId,
          // Only send visibility in workspace mode; personal mode ignores it.
          visibility: activeWorkspaceId ? visibility : undefined,
        });

        if (result) {
          close();
          onCreated?.({
            id: result.id,
            agentId: result.assigneeAgentId ?? undefined,
            identifier: result.identifier,
            name: result.name ?? undefined,
          });
        }
      } catch {
        toast.error(t('createTask.createFailed'));
      }
    }, [
      activeWorkspaceId,
      assigneeAgentId,
      assigneeUserId,
      canCreateTask,
      close,
      execution,
      createTask,
      editor,
      isScheduled,
      onCreated,
      priority,
      projectId,
      scheduleDraft,
      t,
      title,
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

    const handleTitleKeyDown = useTitleEnterToInstruction(editor);

    // Escape is easy to hit by accident, so it asks before throwing away a
    // filled-in task; an empty modal still closes straight away.
    const rootRef = useRef<HTMLDivElement>(null);
    useEscapeDiscardGuard(rootRef, {
      hasUnsavedInput: () =>
        hasUnsavedTaskDraft({
          editorJson: editor?.getDocument?.('json'),
          instruction: instructionRef.current,
          title,
        }),
      onEscape: () =>
        confirmModal({
          cancelText: t('createTask.discardConfirm.cancel'),
          content: t('createTask.discardConfirm.content'),
          okButtonProps: { danger: true },
          okText: t('createTask.discardConfirm.ok'),
          onOk: close,
          title: t('createTask.discardConfirm.title'),
        }),
    });

    // An image pasted into the instruction finishes uploading later; without
    // this, that update would move the caret back from the title mid-typing.
    const handleTitleFocus = useCallback(() => releaseEditorSelection(editor), [editor]);

    return (
      <Flexbox flex={1} ref={rootRef} style={{ minHeight: 0 }} onKeyDown={handleKeyDown}>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ flexShrink: 0, padding: '16px 24px 0' }}
        >
          <input
            autoFocus={canCreateTask}
            disabled={!canCreateTask}
            placeholder={t('createTask.titlePlaceholder')}
            value={title}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              flex: 1,
              fontFamily: 'inherit',
              fontSize: 20,
              fontWeight: 600,
              lineHeight: 1.4,
              minWidth: 0,
              padding: '4px 0',
            }}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={handleTitleFocus}
            onKeyDown={handleTitleKeyDown}
          />
          <Flexbox horizontal gap={4} style={{ flexShrink: 0 }}>
            {showInlineToggle && (
              <ActionIcon
                icon={Minimize2}
                title={t('createTask.expandToInline')}
                onClick={handleInline}
              />
            )}
            <ActionIcon icon={X} onClick={close} />
          </Flexbox>
        </Flexbox>

        {/* Only the instruction scrolls; the title row above stays pinned. A
            full-width block (not flex) scroller keeps the scrollbar on the
            modal's right edge; as a flex item the editor's overflow-hidden
            wrapper would shrink to fit and clip instead of scrolling. */}
        <div style={{ minHeight: 0, overflowY: 'auto' }}>
          <div style={{ minHeight: 144, padding: '0 24px' }}>
            <EditorCanvas
              disabled={!canCreateTask}
              editor={editor}
              floatingToolbar={false}
              placeholder={t('createTask.instructionPlaceholder')}
              style={{ fontSize: 14, paddingBottom: 16 }}
              onContentChange={handleContentChange}
            />
          </div>
        </div>

        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          style={{
            borderTop: `1px solid ${cssVar.colorBorderSecondary}`,
            flexShrink: 0,
            padding: '8px 16px',
          }}
        >
          <Flexbox horizontal gap={2} wrap={'wrap'}>
            {isScheduled && (
              <ScheduleChip
                disabled={!canCreateTask}
                value={scheduleDraft}
                onChange={setScheduleDraft}
              />
            )}

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

            {activeWorkspaceId && (
              <AssigneeMemberSelector
                currentUserId={assigneeUserId}
                taskVisibility={visibility}
                onChange={handleMemberChange}
              >
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
                  {assigneeUserId ? (
                    <>
                      <AssigneeUserAvatar size={18} userId={assigneeUserId} />
                      <Text fontSize={12}>{memberMeta?.title}</Text>
                    </>
                  ) : (
                    <>
                      <UnassignedAssigneeIcon kind={'human'} size={14} />
                      <Text color={cssVar.colorTextDescription} fontSize={12}>
                        {t('createTask.member')}
                      </Text>
                    </>
                  )}
                </Block>
              </AssigneeMemberSelector>
            )}

            {lockAssignee ? (
              <Block
                horizontal
                align="center"
                gap={6}
                height={24}
                paddingBlock={3}
                paddingInline={8}
                variant={'borderless'}
              >
                <AssigneeAvatar agentId={assigneeAgentId} size={18} />
                <Text fontSize={12}>{assigneeMeta?.title}</Text>
              </Block>
            ) : (
              <AssigneeAgentSelector
                currentAgentId={assigneeAgentId}
                taskVisibility={isOtherMemberAssignee ? 'public' : undefined}
                onChange={handleAgentChange}
              >
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
                  {assigneeAgentId ? (
                    <>
                      <AssigneeAvatar agentId={assigneeAgentId} size={18} />
                      <Text fontSize={12}>{assigneeMeta?.title}</Text>
                    </>
                  ) : (
                    <>
                      <UnassignedAssigneeIcon kind={'agent'} size={14} />
                      <Text color={cssVar.colorTextDescription} fontSize={12}>
                        {t('createTask.assignee')}
                      </Text>
                    </>
                  )}
                </Block>
              </AssigneeAgentSelector>
            )}

            {activeWorkspaceId && (
              <TaskVisibilityTag
                visibility={visibility}
                lockedReason={
                  isPrivateAgent
                    ? t('createTask.visibility.privateAgentLocked', {
                        defaultValue: 'Private agents can only run private tasks.',
                      })
                    : isOtherMemberAssignee
                      ? t('createTask.visibility.memberAssigneeLocked', {
                          defaultValue:
                            'A task assigned to a member stays visible to the workspace.',
                        })
                      : undefined
                }
                onChange={setVisibility}
              >
                <TaskVisibilityChipLabel height={24} paddingBlock={3} visibility={visibility} />
              </TaskVisibilityTag>
            )}

            <TaskExecutionControls
              assigneeAgentId={assigneeAgentId}
              disabled={!canCreateTask}
              value={execution}
              onChange={setExecution}
            />

            <ActionIcon
              icon={Paperclip}
              size={'small'}
              title={t('upload.action.tooltip')}
              onClick={handleAttach}
            />
          </Flexbox>

          <Button
            disabled={!canCreateTask || isCreating}
            loading={isCreating}
            shape={'round'}
            size={'small'}
            title={canCreateTask ? undefined : reason}
            type={'primary'}
            onClick={handleSubmit}
          >
            {t(isScheduled ? 'createTask.submitScheduled' : 'createTask.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default CreateTaskContent;
