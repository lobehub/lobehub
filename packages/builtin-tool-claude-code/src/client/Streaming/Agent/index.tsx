'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Button, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ListTree } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import type { AgentArgs } from '../../../types';

const styles = stylex.create({
  container: { paddingBlock: '4px' },
  label: { paddingInlineStart: '4px', fontSize: '12px', color: cssVar.colorTextTertiary },
  labelRow: { marginBlockEnd: '4px' },
  openThread: { height: '22px', paddingInline: '6px', fontSize: '12px' },
  promptBox: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    background: cssVar.colorFillTertiary,
  },
});

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
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      {prompt && (
        <Flexbox>
          <Flexbox
            horizontal
            align={'center'}
            className={stylex.props(styles.labelRow).className}
            justify={'space-between'}
          >
            <Text className={stylex.props(styles.label).className}>
              {t('builtins.lobe-claude-code.agent.instruction')}
            </Text>
            {subagentThread && (
              <Button
                className={stylex.props(styles.openThread).className}
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
          <Flexbox className={stylex.props(styles.promptBox).className}>
            <Markdown variant={'chat'}>{prompt}</Markdown>
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
});

AgentStreaming.displayName = 'ClaudeCodeAgentStreaming';

export default AgentStreaming;
