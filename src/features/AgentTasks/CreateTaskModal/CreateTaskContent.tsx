'use client';

import { useEditor } from '@lobehub/editor/react';
import { Block, Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Text, toast, useModalContext } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Minimize2, Paperclip, X } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { EditorCanvas } from '@/features/EditorCanvas';
import {
  getAttachmentFileIdsFromEditor,
  pickAndInsertAttachments,
} from '@/features/EditorCanvas/editorAttachments';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import AssigneeMemberSelector from '../features/AssigneeMemberSelector';
import AssigneeUserAvatar from '../features/AssigneeUserAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { UnassignedAssigneeIcon } from '../features/UnassignedAssigneeIcon';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';
import { useUserDisplayMeta } from '../shared/useUserDisplayMeta';

export interface CreateTaskContentProps {
  agentId?: string;
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  projectId?: string;
  /**
   * Whether to show the "minimize to inline entry" button. Only the list view has an
   * inline entry target, so contexts like the Kanban board pass `false` to hide it.
   */
  showInlineToggle?: boolean;
}

const CreateTaskContent = memo<CreateTaskContentProps>(
  ({ agentId, lockAssignee, onCreated, projectId, showInlineToggle = true }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();
    const { allowed: canCreateTask, reason } = usePermission('create_content');

    const createTask = useTaskStore((s) => s.createTask);
    const isCreating = useTaskStore((s) => s.isCreatingTask);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

    const activeWorkspaceId = useActiveWorkspaceId();

    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState(0);
    const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
    const [assigneeUserId, setAssigneeUserId] = useState<string | undefined>();
    // Default to workspace-visible: workspace tasks are team work by default,
    // and going private stays one click away. In personal mode the field is
    // irrelevant and the chip is hidden anyway.
    const [visibility, setVisibility] = useState<'private' | 'public'>('public');

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

      // `createTask` keeps its rejecting contract; surface the failure here so a
      // failed create isn't silent and the modal stays open with its content.
      try {
        const result = await createTask({
          assigneeAgentId,
          assigneeUserId,
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
            agentId: result.assigneeAgentId ?? undefined,
            identifier: result.identifier,
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
      createTask,
      editor,
      onCreated,
      priority,
      projectId,
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

    return (
      <Flexbox onKeyDown={handleKeyDown}>
        <Flexbox horizontal style={{ padding: '16px 24px 0' }}>
          <Flexbox flex={1} style={{ minHeight: 180 }}>
            <input
              autoFocus={canCreateTask}
              disabled={!canCreateTask}
              placeholder={t('createTask.titlePlaceholder')}
              value={title}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                fontFamily: 'inherit',
                fontSize: 20,
                fontWeight: 600,
                lineHeight: 1.4,
                outline: 'none',
                padding: '4px 0',
                width: '100%',
              }}
              onChange={(e) => setTitle(e.target.value)}
            />
            <EditorCanvas
              disabled={!canCreateTask}
              editor={editor}
              floatingToolbar={false}
              placeholder={t('createTask.instructionPlaceholder')}
              style={{ fontSize: 14, paddingBottom: 16 }}
              onContentChange={handleContentChange}
            />
          </Flexbox>
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

        <Flexbox
          horizontal
          align={'center'}
          justify={'space-between'}
          style={{ borderTop: `1px solid ${cssVar.colorBorderSecondary}`, padding: '8px 16px' }}
        >
          <Flexbox horizontal gap={2} wrap={'wrap'}>
            <TaskPriorityTag priority={priority} onChange={setPriority}>
              <Block
                clickable
                horizontal
                align="center"
                gap={6}
                paddingBlock={4}
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
                  paddingBlock={4}
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
                paddingBlock={4}
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
                  paddingBlock={4}
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
                <TaskVisibilityChipLabel visibility={visibility} />
              </TaskVisibilityTag>
            )}

            <ActionIcon
              icon={Paperclip}
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
            {t('createTask.submit')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

export default CreateTaskContent;
