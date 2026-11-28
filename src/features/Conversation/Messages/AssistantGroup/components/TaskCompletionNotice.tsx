import type { MessageTaskStatus } from '@lobechat/types';
import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import { Bell, CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getToolDisplayName } from '../toolDisplayNames';
import type { TaskCompletionSource } from '../utils/taskCompletionSource';

/** Legacy messages carry no status, so they get a neutral `ended` reading. */
const STATUS_ICONS: Record<MessageTaskStatus | 'ended', { color: string; icon: LucideIcon }> = {
  completed: { color: cssVar.colorSuccess, icon: CircleCheck },
  ended: { color: cssVar.colorTextSecondary, icon: Bell },
  failed: { color: cssVar.colorError, icon: CircleAlert },
  stopped: { color: cssVar.colorTextTertiary, icon: CircleSlash },
};

/**
 * Marks where a background task's completion woke the agent again, the way
 * Claude Code's own `Agent "…" finished` notification separates the turns, so
 * the reply that follows reads as a response to that event rather than as a
 * continuation of the text above it. It names the task in the reader's terms
 * (a subagent, a background command) and never the internal tool that woke it.
 */
const TaskCompletionNotice = ({ kind, status, summary, title, toolName }: TaskCompletionSource) => {
  const { t } = useTranslation('chat');
  const state = status ?? 'ended';
  const { color, icon } = STATUS_ICONS[state];
  const subject =
    kind === 'tool' ? getToolDisplayName(toolName) : t(`taskCompletion.subject.${kind}`);
  const statusText = t(`taskCompletion.status.${state}`);

  return (
    <Flexbox horizontal align="center" gap={8} paddingBlock={4} paddingInline={4}>
      <Block
        horizontal
        align="center"
        flex="none"
        height={24}
        justify="center"
        style={{ fontSize: 12 }}
        variant="outlined"
        width={24}
      >
        <Icon color={color} icon={icon} />
      </Block>
      {/* The raw summary keeps details the notice drops, such as a failed command's exit code. */}
      <Text ellipsis as="span" title={summary} type="secondary">
        {title
          ? t('taskCompletion.notice', { status: statusText, subject, title })
          : t('taskCompletion.noticeWithoutTitle', { status: statusText, subject })}
      </Text>
    </Flexbox>
  );
};

export default TaskCompletionNotice;
