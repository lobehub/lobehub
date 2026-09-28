'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Markdown } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AlertTriangle, ListTree } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import { stripSubAgentReference } from '../../../subAgentReference';
import type { CallSubAgentParams, CallSubAgentState } from '../../../types';

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
  stoppedLabel: css`
    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
  stoppedResultBox: css`
    border: 1px solid ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
}));

/**
 * Render for lobe-agent's `callSubAgent` tool.
 *
 * A sub-agent runs in an isolated Thread via the current runtime, so this view
 * shows the instruction sent to it plus its closing summary (the tool result),
 * and exposes a toggle to open / collapse that Thread in the portal. The Thread
 * is located by the `threadId` persisted in tool state; while the run is still
 * starting the lookup can return `undefined`, so the button is hidden rather
 * than rendered as a dead no-op.
 *
 * A run that stopped before finishing is marked with a warning, so its partial
 * summary is not mistaken for a finished result.
 */
export const CallSubAgentRender = memo<
  BuiltinRenderProps<CallSubAgentParams, CallSubAgentState, string>
>(({ args, content, pluginState }) => {
  const { t } = useTranslation('plugin');
  const { t: tChat } = useTranslation('chat');
  const prompt = args?.instruction?.trim();
  const result = typeof content === 'string' ? stripSubAgentReference(content).trim() : '';
  const threadId = pluginState?.threadId;
  const stopped = pluginState?.status === 'error';

  const subagentThread = useChatStore((s) =>
    threadId
      ? (threadSelectors.currentTopicThreads(s) ?? []).find((thread) => thread.id === threadId)
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
            {stopped ? (
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={cssVar.colorWarning} icon={AlertTriangle} size={14} />
                <Text className={styles.stoppedLabel}>
                  {t('builtins.lobe-agent.subAgent.stopped')}
                </Text>
              </Flexbox>
            ) : (
              <Text className={styles.label}>{t('builtins.lobe-claude-code.agent.result')}</Text>
            )}
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
            <Flexbox className={cx(styles.resultBox, stopped && styles.stoppedResultBox)}>
              <Markdown style={{ maxHeight: 320, overflow: 'auto' }} variant={'chat'}>
                {result}
              </Markdown>
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

CallSubAgentRender.displayName = 'CallSubAgentRender';

export default CallSubAgentRender;
