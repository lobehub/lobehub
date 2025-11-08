'use client';

import { UIChatMessage } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { Button, Text } from '@lobehub/ui';
import { createStyles, useTheme } from 'antd-style';
import { LucideRefreshCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { DEFAULT_SUPERVISOR_AVATAR } from '@/const/meta';
import { ChatItem } from '@/features/ChatItem';
import { useChatStore } from '@/store/chat';
import { ChatErrorType } from '@/types/fetch';

import TodoList, { TodoData } from './TodoList';

const useStyles = createStyles(({ token, css, cx }) => ({
  modelInfo: cx(css`
    font-size: 12px;
    color: ${token.colorTextQuaternary};
  `),
}));

// Helper function to parse legacy markdown todo format
const parseMarkdownTodos = (content: string): TodoData => {
  const lines = content.split('\n');
  const todos: Array<{ content: string; finished: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Match todo item pattern: - [x] or - [ ] followed by content
    const todoMatch = trimmed.match(/^-\s*\[([\sx])]\s*(.+)$/i);
    if (todoMatch) {
      const [, checkbox, todoContent] = todoMatch;
      const finished = checkbox.toLowerCase() === 'x';

      // Remove strikethrough formatting if present
      const content = todoContent.replace(/^~~(.+)~~$/, '$1');

      todos.push({
        content: content.trim(),
        finished,
      });
    }
  }

  return {
    timestamp: Date.now(),
    todos,
    type: 'supervisor_todo',
  };
};

interface SupervisorMessageProps extends UIChatMessage {
  disableEditing?: boolean;
  index: number;
}

const SupervisorMessage = memo<SupervisorMessageProps>((props) => {
  const { id, content, error, groupId, role, updatedAt, createdAt } = props;
  const { t } = useTranslation('chat');
  const theme = useTheme();
  const { styles } = useStyles();
  const [triggerSupervisorDecision, deleteMessage] = useChatStore((s) => [
    s.internal_triggerSupervisorDecision,
    s.deleteMessage,
  ]);

  // Try to parse the message content as JSON for todo data
  let todoData: TodoData | null = null;
  let isTodoMessage = false;

  if (content && !error) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.type === 'supervisor_todo' && Array.isArray(parsed.todos)) {
        todoData = parsed as TodoData;
        isTodoMessage = true;
      }
    } catch {
      // Not JSON or invalid format, check for legacy markdown format
      if (role === 'supervisor' && content?.startsWith('### Todo List')) {
        todoData = parseMarkdownTodos(content);
        isTodoMessage = true;
      }
    }
  }

  const errorText =
    error?.type === ChatErrorType.SupervisorDecisionFailed
      ? t('supervisor.decisionFailed', { ns: 'error' })
      : error?.message;

  // Retry action for supervisor decision failure
  const handleRetry = useCallback(async () => {
    if (!groupId) return;

    // Delete the error message first
    await deleteMessage(id);

    // Then trigger the supervisor decision
    triggerSupervisorDecision(groupId, undefined, true);
  }, [groupId, id, deleteMessage, triggerSupervisorDecision]);

  const errorContentNode = errorText ? (
    <Flexbox
      gap={8}
      style={{
        background: theme.colorBgContainer,
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: 8,
        marginBottom: 12,
        maxWidth: '400px',
        padding: 12,
      }}
    >
      <Text>{errorText}</Text>
      {role === 'supervisor' && groupId && (
        <Button icon={LucideRefreshCw} onClick={handleRetry} type={'primary'}>
          {t('retry', { ns: 'common' })}
        </Button>
      )}
    </Flexbox>
  ) : undefined;

  // Render todo message with dedicated component
  if (isTodoMessage && todoData) {
    const model = props.extra?.fromModel;
    const provider = props.extra?.fromProvider;
    const hasModelInfo = model || provider;

    return (
      <ChatItem
        avatar={{
          avatar: DEFAULT_SUPERVISOR_AVATAR,
          title: t('groupSidebar.members.orchestrator'),
        }}
        loading={false}
        placement="left"
        primary={false}
        renderMessage={() => (
          <Flexbox gap={8}>
            <TodoList data={todoData} />
            {hasModelInfo && (
              <Flexbox align={'center'} className={styles.modelInfo} gap={4} horizontal>
                {model && <ModelIcon model={model} type={'mono'} />}
                {provider && model ? `${provider}/${model}` : provider || model}
              </Flexbox>
            )}
          </Flexbox>
        )}
        showTitle={true}
        time={updatedAt || createdAt}
        variant="bubble"
      />
    );
  }

  // Render regular supervisor message
  const renderErrorMessage = error ? () => errorContentNode : undefined;

  return (
    <ChatItem
      avatar={{
        avatar: DEFAULT_SUPERVISOR_AVATAR,
        title: t('groupSidebar.members.orchestrator'),
      }}
      loading={false}
      message={error ? undefined : content}
      placement="left"
      primary={false}
      renderMessage={renderErrorMessage}
      showTitle={true}
      time={updatedAt || createdAt}
      variant={isTodoMessage || error ? 'docs' : 'bubble'}
    />
  );
});

SupervisorMessage.displayName = 'SupervisorMessage';

export default SupervisorMessage;
