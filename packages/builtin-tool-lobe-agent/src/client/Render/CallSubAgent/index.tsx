'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Button, cx, Flexbox, Icon, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { AlertTriangle, ListTree } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors, threadSelectors } from '@/store/chat/selectors';

import { stripSubAgentReference } from '../../../subAgentReference';
import type { CallSubAgentParams, CallSubAgentState } from '../../../types';

const styles = stylex.create({ container: { paddingBlock: "4px" }, label: { paddingInlineStart: "4px", fontSize: "12px", color: cssVar.colorTextTertiary }, labelRow: { marginBlockEnd: "4px" }, openThread: { height: "22px", paddingInline: "6px", fontSize: "12px" }, promptBox: { paddingBlock: "8px", paddingInline: "12px", borderRadius: cssVar.borderRadiusLG, backgroundColor: cssVar.colorFillTertiary, backgroundImage: "none" }, resultBox: { paddingBlock: "8px", paddingInline: "12px", borderRadius: cssVar.borderRadiusLG, backgroundColor: cssVar.colorBgContainer, backgroundImage: "none" }, stoppedLabel: { fontSize: "12px", color: cssVar.colorWarning }, stoppedResultBox: { borderWidth: "1px", borderStyle: "solid", borderColor: cssVar.colorWarningBorder, backgroundColor: cssVar.colorWarningBg, backgroundImage: "none" } });

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
 * summary is not mistaken for a finished result. A background run says it is
 * still running until its answer arrives on the state.
 */
export const CallSubAgentRender = memo<
  BuiltinRenderProps<CallSubAgentParams, CallSubAgentState, string>
>(({ args, content, pluginState }) => {
  const { t } = useTranslation('plugin');
  const { t: tChat } = useTranslation('chat');
  const prompt = args?.instruction?.trim();
  // A background run's tool result is only its start receipt; the answer is
  // kept on the state once it arrives.
  const background = pluginState?.background === true;
  const result = background
    ? (pluginState?.result ?? '').trim()
    : typeof content === 'string'
      ? stripSubAgentReference(content).trim()
      : '';
  const runningInBackground = background && pluginState?.status === 'pending';
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

  const showResultSection = !!result || !!subagentThread || runningInBackground;

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      {prompt && (
        <Flexbox>
          <Text className={stylex.props(styles.label).className} style={{ marginBlockEnd: 4 }}>
            {t('builtins.lobe-claude-code.agent.instruction')}
          </Text>
          <Flexbox className={stylex.props(styles.promptBox).className}>
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
            className={stylex.props(styles.labelRow).className}
            justify={'space-between'}
          >
            {stopped ? (
              <Flexbox horizontal align={'center'} gap={4}>
                <Icon color={cssVar.colorWarning} icon={AlertTriangle} size={14} />
                <Text className={stylex.props(styles.stoppedLabel).className}>
                  {t('builtins.lobe-agent.subAgent.stopped')}
                </Text>
              </Flexbox>
            ) : runningInBackground ? (
              <Text className={stylex.props(styles.label).className}>
                {t('builtins.lobe-agent.subAgent.backgroundRunning')}
              </Text>
            ) : (
              <Text className={stylex.props(styles.label).className}>{t('builtins.lobe-claude-code.agent.result')}</Text>
            )}
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
          {runningInBackground && (
            <Text className={stylex.props(styles.label).className}>{t('builtins.lobe-agent.subAgent.backgroundHint')}</Text>
          )}
          {result && (
            <Flexbox className={stylex.props(styles.resultBox, stopped && styles.stoppedResultBox).className}>
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
