'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
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
  resultBox: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
}));

/**
 * Render for CC's `Agent` (subagent-spawn) tool.
 *
 * The Inspector row already shows `[icon] subagent_type [chip: description]`,
 * so this view skips the header and goes straight to the two blocks the
 * Inspector can't fit: the full `prompt` and the subagent's closing summary
 * (`content`) — both as Markdown because CC routinely passes multi-paragraph
 * or code-fenced prompts and the summary is prose. Each block is labelled
 * since the two Markdown bubbles are otherwise indistinguishable once the
 * subagent's reply happens to use the same tone as the prompt.
 *
 * Each subagent spawn also persists as a Thread linked by
 * `metadata.sourceToolCallId = toolCallId`; when that Thread exists, the
 * result-label row exposes a toggle to open / collapse it in the portal
 * (clicking again while already open closes it rather than acting as a
 * dead-end disabled state). The executor creates the Thread lazily on the
 * first subagent event, so the lookup can briefly return `undefined` — the
 * button is hidden in that window instead of faked into a no-op.
 */
const Agent = memo<BuiltinRenderProps<AgentArgs, unknown, string>>(
  ({ args, content, toolCallId }) => {
    const { t } = useTranslation('plugin');
    const { t: tChat } = useTranslation('chat');
    const prompt = args?.prompt?.trim();
    const result = typeof content === 'string' ? content.trim() : '';

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

    if (!prompt && !result && !subagentThread) return null;

    const showResultSection = !!result || !!subagentThread;

    return (
      <Flexbox className={styles.container} gap={12}>
        {prompt && (
          <Flexbox>
            <Text className={styles.label} style={{ marginBlockEnd: 4 }}>
              {t('builtins.lobe-claude-code.agent.instruction')}
            </Text>
            <Flexbox className={styles.promptBox}>
              <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant={'chat'}>
                {prompt}
              </Markdown>
            </Flexbox>
          </Flexbox>
        )}

        {showResultSection && (
          <Flexbox>
            <Flexbox
              horizontal
              align={'center'}
              className={styles.labelRow}
              justify={'space-between'}
            >
              <Text className={styles.label}>{t('builtins.lobe-claude-code.agent.result')}</Text>
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
            {result && (
              <Flexbox className={styles.resultBox}>
                <Markdown style={{ maxHeight: 320, overflow: 'auto' }} variant={'chat'}>
                  {result}
                </Markdown>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

Agent.displayName = 'ClaudeCodeAgent';

export default Agent;
