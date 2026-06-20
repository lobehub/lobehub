'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronUp, Paperclip, UserCircle2 } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

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

  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [instruction, setInstruction] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);

  const editor = useEditor();

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

  // When the assignee is locked to a scoped agent, keep it in sync with the
  // `agentId` prop. The route subtree is reused across /agent/A/tasks ->
  // /agent/B/tasks, so without this the hidden assignee would stay on A.
  useEffect(() => {
    if (lockAssignee) setAssigneeAgentId(agentId);
  }, [agentId, lockAssignee]);

  useEffect(() => {
    if (!canCreateTask) return;
    if (autoFocus || isHero) editor?.focus?.();
  }, [autoFocus, canCreateTask, editor, isHero]);

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

    const result = await createTask({
      assigneeAgentId,
      editorData: editorJson,
      instruction: markdown || trimmedText || name || '',
      name,
      parentTaskId,
      priority: priority || undefined,
    });

    if (result) {
      setPriority(0);
      setAssigneeAgentId(agentId);
      setInstruction('');
      editor?.cleanDocument?.();
      onCreated?.({
        agentId: result.assigneeAgentId ?? undefined,
        identifier: result.identifier,
      });
    }
  }, [
    agentId,
    assigneeAgentId,
    createTask,
    editor,
    instruction,
    onCreated,
    parentTaskId,
    priority,
    canCreateTask,
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
      onKeyDown={handleKeyDown}
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
          padding: isHero ? '20px 24px 4px' : '12px 40px 0 16px',
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
            paddingBottom: isHero ? 16 : 12,
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
    </Block>
  );
});

export default CreateTaskInlineEntry;
