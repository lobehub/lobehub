'use client';

import { ChatErrorType } from '@lobechat/types';
import { ActionIcon, Flexbox, TextArea } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { SendHorizonal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useIMECompositionEvent } from '@/hooks/useIMECompositionEvent';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { shouldSubmitOnEnter } from './composerEnterGuard';
import { useBudgetStatusRetry } from './useBudgetStatusRetry';

interface VisitorComposerProps {
  agentId: string;
  /**
   * Copy key of a standing block (e.g. exhausted share budget). When set the
   * composer is disabled and the reason is shown persistently — sending would
   * only fail server-side anyway.
   */
  blockedKey?: string;
  /** Refresh the visitor topic list after a send created a new topic. */
  onTopicCreated?: (topicId: string) => void;
  shareId: string;
  topicId?: string | null;
}

/** Map a share-run failure to the visitor-facing copy key. */
const resolveErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(ChatErrorType.ShareTurnLimitExceeded))
    return 'share.visitor.errors.turnLimit';
  if (message.includes(ChatErrorType.ShareTopicLimitExceeded))
    return 'share.visitor.errors.topicLimit';
  if (message.includes(ChatErrorType.InsufficientBudgetForModel))
    return 'share.visitor.errors.insufficientBudget';
  if (message.includes(ChatErrorType.AgentShareProviderNotSupported))
    return 'share.visitor.errors.providerNotSupported';
  if (message.includes(ChatErrorType.ShareHeterogeneousAgentUnsupported))
    return 'share.visitor.errors.heterogeneousUnsupported';
  return 'share.visitor.errors.generic';
};

/**
 * Lean visitor composer for shared agents. Intentionally NOT the owner
 * composer graph (see readOnlyImportBoundary.test.ts): no uploads (v1 rejects
 * them server-side anyway), no mentions, no device targets — just text in,
 * gateway-streamed answer out.
 */
const VisitorComposer = memo<VisitorComposerProps>(
  ({ agentId, blockedKey, onTopicCreated, shareId, topicId }) => {
    const { t } = useTranslation('agent');
    const [value, setValue] = useState('');
    const [errorKey, setErrorKey] = useState<string>();
    const [sending, setSending] = useState(false);
    const { checkingBlock, retryBlockedCheck, retryCheckError } = useBudgetStatusRetry(
      shareId,
      blockedKey,
    );
    const { compositionProps, isComposingRef } = useIMECompositionEvent();

    const isStreaming = useChatStore(
      // messageMapKey ignores agentShareId — the running check keys off the
      // same main_<agentId>_<topicId> bucket the share run registers under.
      operationSelectors.isAgentRuntimeRunningByContext({
        agentId,
        scope: 'main',
        topicId,
      }),
    );
    const busy = sending || isStreaming;
    const displayedErrorKey = blockedKey ?? errorKey;

    const send = async () => {
      const message = value.trim();
      if (!message || busy || blockedKey) return;

      setErrorKey(undefined);
      setSending(true);
      setValue('');
      try {
        const result = await useChatStore.getState().executeGatewayAgent({
          context: {
            agentId,
            agentShareId: shareId,
            scope: 'main',
            topicId: topicId ?? undefined,
          },
          message,
        });
        if (result.topicId && !topicId) onTopicCreated?.(result.topicId);
      } catch (error) {
        console.error('[AgentShareVisitor] send failed:', error);
        setErrorKey(resolveErrorKey(error));
        // Give the rejected input back so the visitor can retry / edit.
        setValue(message);
      } finally {
        setSending(false);
      }
    };

    return (
      <Flexbox gap={4} paddingBlock={8} paddingInline={12}>
        {displayedErrorKey && (
          <Flexbox horizontal align="center" gap={8}>
            <span style={{ color: cssVar.colorError, fontSize: 12 }}>
              {t(displayedErrorKey as any)}
            </span>
            {/* Once the retry check itself has failed, the AsyncError row below
              takes over the retry action so the visitor gets feedback specific
              to that failure instead of a silently-reset spinner. */}
            {blockedKey && !retryCheckError && (
              <Button
                loading={checkingBlock}
                size="small"
                type="text"
                onClick={() => void retryBlockedCheck()}
              >
                {t('share.visitor.errors.retry')}
              </Button>
            )}
          </Flexbox>
        )}
        {blockedKey && !!retryCheckError && (
          <AsyncError
            error={retryCheckError}
            retrying={checkingBlock}
            title={t('share.visitor.errors.retryCheckFailed')}
            variant="inline"
            onRetry={() => void retryBlockedCheck()}
          />
        )}
        <Flexbox
          horizontal
          // Center the single-line state (the textarea is shorter than the send
          // button, so the text would otherwise hug the bottom edge); once the
          // textarea grows it becomes the tallest child and the button pins to
          // the bottom via its own alignSelf.
          align={'center'}
          gap={8}
          style={{
            background: cssVar.colorFillQuaternary,
            border: `1px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: 12,
            padding: '6px 6px 6px 12px',
          }}
        >
          <TextArea
            autoSize={{ maxRows: 6, minRows: 1 }}
            disabled={!!blockedKey}
            placeholder={t('share.visitor.input.placeholder')}
            style={{ border: 'none', boxShadow: 'none', padding: 0 }}
            value={value}
            variant={'borderless'}
            onChange={(e) => setValue(e.target.value)}
            {...compositionProps}
            onPressEnter={(e) => {
              if (!shouldSubmitOnEnter(e, isComposingRef.current)) return;
              e.preventDefault();
              void send();
            }}
          />
          <ActionIcon
            disabled={busy || !!blockedKey || !value.trim()}
            icon={SendHorizonal}
            loading={busy}
            style={{ alignSelf: 'flex-end' }}
            title={t('share.visitor.input.send')}
            onClick={() => void send()}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

VisitorComposer.displayName = 'ShareVisitorComposer';

export default VisitorComposer;
