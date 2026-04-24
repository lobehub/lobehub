'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { Minimize2, UserCircle2, X } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useGlobalStore } from '@/store/global';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

export interface CreateTaskContentProps {
  agentId?: string;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
  /**
   * Whether to show the "minimize to inline entry" button. Only the list view has an
   * inline entry target, so contexts like the Kanban board pass `false` to hide it.
   */
  showInlineToggle?: boolean;
}

const CreateTaskContent = memo<CreateTaskContentProps>(
  ({ agentId, onCreated, showInlineToggle = true }) => {
    const { t } = useTranslation('chat');
    const { close } = useModalContext();

    const createTask = useTaskStore((s) => s.createTask);
    const isCreating = useTaskStore((s) => s.isCreatingTask);
    const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState(0);
    const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);

    const editor = useEditor();
    const instructionRef = useRef('');

    const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

    const handleInline = useCallback(() => {
      updateSystemStatus({ taskCreateInlineCollapsed: false }, 'expandTaskCreateInline');
      close();
    }, [close, updateSystemStatus]);

    const handleContentChange = useCallback(() => {
      if (!editor) return;
      instructionRef.current = String(editor.getDocument('markdown') ?? '');
    }, [editor]);

    const handleSubmit = useCallback(async () => {
      const instruction = instructionRef.current.trim();
      if (!instruction && !title.trim()) return;

      const result = await createTask({
        assigneeAgentId,
        instruction: instruction || title.trim(),
        name: title.trim() || undefined,
        priority: priority || undefined,
      });

      if (result) {
        close();
        onCreated?.({
          agentId: result.assigneeAgentId ?? undefined,
          identifier: result.identifier,
        });
      }
    }, [assigneeAgentId, close, createTask, onCreated, priority, title]);

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
              autoFocus
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
            disabled={isCreating}
            loading={isCreating}
            shape={'round'}
            size={'small'}
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
