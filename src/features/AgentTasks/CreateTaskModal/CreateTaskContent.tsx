'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { Button } from 'antd';
import { cssVar } from 'antd-style';
import { UserCircle2, X } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas } from '@/features/EditorCanvas';
import { useTaskStore } from '@/store/task';

import AssigneeAgentSelector from '../features/AssigneeAgentSelector';
import AssigneeAvatar from '../features/AssigneeAvatar';
import TaskPriorityTag from '../features/TaskPriorityTag';
import { useAgentDisplayMeta } from '../shared/useAgentDisplayMeta';

export interface CreateTaskContentProps {
  agentId?: string;
  onCreated?: (task: { agentId?: string; identifier: string }) => void;
}

const CreateTaskContent = memo<CreateTaskContentProps>(({ agentId, onCreated }) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();

  const createTask = useTaskStore((s) => s.createTask);
  const isCreating = useTaskStore((s) => s.isCreatingTask);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState(0);
  const [assigneeAgentId, setAssigneeAgentId] = useState<string | undefined>(agentId);

  const editor = useEditor();
  const instructionRef = useRef('');

  const assigneeMeta = useAgentDisplayMeta(assigneeAgentId);

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

  return (
    <Flexbox>
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
            style={{ paddingBottom: 16 }}
            onContentChange={handleContentChange}
          />
        </Flexbox>
        <ActionIcon icon={X} style={{ flexShrink: 0 }} onClick={close} />
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
          size={'small'}
          type={'primary'}
          onClick={handleSubmit}
        >
          {t('createTask.submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default CreateTaskContent;
