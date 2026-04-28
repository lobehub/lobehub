'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Button, Flexbox, Markdown, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ListTree } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import type { AgentArgs } from '../../../types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 4px;
  `,
  label: css`
    padding-inline-start: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  labelRow: css`
    margin-block-end: 4px;
  `,
  openThread: css`
    height: 22px;
    padding-inline: 6px;
    font-size: 12px;
  `,
  promptBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillTertiary};
  `,
}));

/**
 * Streaming view for CC's `Agent` tool — shown while the subagent is still
 * running (args parsed, no tool_result yet). Mirrors `Render/Agent` but drops
 * the result block, since it hasn't arrived. If the executor has already
 * created the subagent Thread, surface the "open subtopic" toggle alongside
 * the instruction so the user can jump into the live subagent conversation.
 */
const AgentStreaming = memo<BuiltinStreamingProps<AgentArgs>>(({ args, toolCallId }) => {
  const { t } = useTranslation('plugin');
  const { t: tChat } = useTranslation('chat');
  const prompt = args?.prompt?.trim();

  const subagentThread = useChatStore((s) =>
    toolCallId
      ? (threadSelectors.currentTopicThreads(s) ?? []).find(
          (thread) => thread.metadata?.sourceToolCallId === toolCallId,
        )
      : undefined,
  );
  const openThreadInPortal = useChatStore((s) => s.openThreadInPortal);
  const closeThreadPortal = useChatStore((s) => s.closeThreadPortal);
  const portalThreadId = useChatStore(portalThreadSelectors.portalThreadId);
  const isOpenInPortal = !!subagentThread && portalThreadId === subagentThread.id;

  const handleToggleThread = useCallback(() => {
    if (!subagentThread) return;
    if (isOpenInPortal) {
      closeThreadPortal();
    } else {
      openThreadInPortal(subagentThread.id, subagentThread.sourceMessageId);
    }
  }, [subagentThread, isOpenInPortal, openThreadInPortal, closeThreadPortal]);

  if (!prompt && !subagentThread) return null;

  return (
    <Flexbox className={styles.container} gap={12}>
      {prompt && (
        <Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={styles.labelRow}
            justify={'space-between'}
          >
            <Text className={styles.label}>{t('builtins.lobe-claude-code.agent.instruction')}</Text>
            {subagentThread && (
              <Button
                className={styles.openThread}
                icon={ListTree}
                size={'small'}
                type={'text'}
                onClick={handleToggleThread}
              >
                {isOpenInPortal
                  ? tChat('thread.closeSubagentThread')
                  : tChat('thread.openSubagentThread')}
              </Button>
            )}
          </Flexbox>
          <Flexbox className={styles.promptBox}>
            <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
              {prompt}
            </Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentStreaming.displayName = 'ClaudeCodeAgentStreaming';

export default AgentStreaming;
