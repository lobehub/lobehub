'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { Minimize2, Paperclip, UserCircle2, X } from 'lucide-react';
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

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import TaskVisibilityChipLabel from '../features/TaskVisibilityChipLabel';
import TaskVisibilityTag from '../features/TaskVisibilityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';
import { useAgentVisibility } from '../shared/useAgentVisibility';

export interface CreateTaskContentProps {
  agentId?: string;
  /**
   * Locks the assignee to `agentId` and hides the agent picker. Used on the
   * agent-scoped task list where every task belongs to that agent.
   */
  lockAssignee?: boolean;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  /**
   * Whether to show the "minimize to inline entry" button. Only the list view has an
   * inline entry target, so contexts like the Kanban board pass `false` to hide it.
   */
  showInlineToggle?: boolean;
}

const CreateTaskContent = memo<CreateTaskContentProps>(
  ({ agentId, lockAssignee, onCreated, showInlineToggle = true }) => {
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
    // Default to private in workspace mode so the user has to opt in to share.
    // In personal mode the field is irrelevant and the chip is hidden anyway.
    const [visibility, setVisibility] = useState<'private' | 'public'>('private');

    // LOBE-10961: a private agent can only run a private task. When the
    // selected agent is private we force visibility back to private and lock
    // the chip so the user can't pick Workspace.
    const assigneeVisibility = useAgentVisibility(assigneeAgentId);
    const isPrivateAgent = assigneeVisibility === 'private';
    useEffect(() => {
      if (isPrivateAgent && visibility === 'public') setVisibility('private');
    }, [isPrivateAgent, visibility]);

    const editor = useEditor();
    const instructionRef = useRef('');

    const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

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

      const result = await createTask({
        assigneeAgentId,
        editorData: editorJson,
        instruction: instruction || title.trim(),
        name: title.trim() || undefined,
        priority: priority || undefined,
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
    }, [
      activeWorkspaceId,
      assigneeAgentId,
      canCreateTask,
      close,
      createTask,
      editor,
      onCreated,
      priority,
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

            {(() => {
              const assigneeChip = (
                <Block
                  horizontal
                  align="center"
                  clickable={!lockAssignee}
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
                <AssigneeAgentSelector
                  currentAgentId={assigneeAgentId}
                  onChange={setAssigneeAgentId}
                >
                  {assigneeChip}
                </AssigneeAgentSelector>
              );
            })()}

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
