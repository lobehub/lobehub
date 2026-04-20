'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { $getRoot } from 'lexical';
import { ChevronUp, UserCircle2 } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

interface CreateTaskInlineEntryProps {
  agentId?: string;
  autoFocus?: boolean;
  onCollapse?: () => void;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  parentTaskId?: string;
  placeholder?: string;
}

const CreateTaskInlineEntry = memo<CreateTaskInlineEntryProps>((props) => {
  const { agentId, autoFocus, onCollapse, onCreated, parentTaskId, placeholder } = props;
  const { t } = useTranslation('chat');

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);
  const [instruction, setInstruction] = useState('');

  const editor = useEditor();

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

  useEffect(() => {
    if (autoFocus) editor?.focus?.();
  }, [autoFocus, editor]);

  const handleCollapse = useCallback(() => {
    if (onCollapse) {
      onCollapse();
      return;
    }
    updateSystemStatus({ taskCreateInlineCollapsed: true }, 'collapseTaskCreateInline');
  }, [onCollapse, updateSystemStatus]);

  const handleContentChange = useCallback(() => {
    const lexicalEditor = editor?.getLexicalEditor?.();
    if (!lexicalEditor) return;
    lexicalEditor.getEditorState().read(() => {
      setInstruction($getRoot().getTextContent());
    });
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;

    const result = await createTask({
      assigneeAgentId,
      instruction: trimmed,
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
      <ActionIcon
        icon={ChevronUp}
        size={'small'}
        style={{ position: 'absolute', right: 8, top: 8, zIndex: 1 }}
        title={t('createTask.collapse')}
        onClick={handleCollapse}
      />
      <Flexbox style={{ fontSize: 14, minHeight: 120, padding: '12px 40px 0 16px' }}>
        <EditorCanvas
          editor={editor}
          floatingToolbar={false}
          placeholder={placeholder ?? t('createTask.instructionPlaceholder')}
          style={{ fontSize: 14, paddingBottom: 12 }}
          onContentChange={handleContentChange}
        />
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

          <AssigneeAgentSelector currentAgentId={assigneeAgentId} onChange={setAssigneeAgentId}>
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
                  <Icon color={cssVar.colorTextDescription} icon={UserCircle2} size={14} />
                  <Text color={cssVar.colorTextDescription} fontSize={12}>
                    {t('createTask.assignee')}
                  </Text>
                </>
              )}
            </Block>
          </AssigneeAgentSelector>
        </Flexbox>

        <Button
          disabled={isCreating || !instruction.trim()}
          loading={isCreating}
          shape={'round'}
          size={'small'}
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
