import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getToolDisplayName } from '../toolDisplayNames';
import type { TaskCompletionSource } from '../utils/taskCompletionSource';

/**
 * Marks where a long-running tool's completion woke the agent again, the way
 * Claude Code's own `Agent "…" finished` notification separates the turns, so
 * the reply that follows reads as a response to that event rather than as a
 * continuation of the text above it.
 */
const TaskCompletionNotice = ({ description, toolName }: TaskCompletionSource) => {
  const { t } = useTranslation('chat');
  const tool = getToolDisplayName(toolName);

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
        <Icon color={cssVar.colorTextSecondary} icon={Bell} />
      </Block>
      <Text ellipsis as="span" type="secondary">
        {description
          ? t('taskCompletion.title', { description, tool })
          : t('taskCompletion.titleWithoutDescription', { tool })}
      </Text>
    </Flexbox>
  );
};

export default TaskCompletionNotice;
