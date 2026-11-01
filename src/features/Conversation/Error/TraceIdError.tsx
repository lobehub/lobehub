import { SOCIAL_URL } from '@lobechat/business-const';
import type { ChatMessageError } from '@lobechat/types';
import { Button, copyToClipboard, cssVar, Flexbox, Icon, toast } from '@lobehub/ui';
import { DiscordIcon } from '@lobehub/ui/icons';
import { AlertTriangle, Copy, RotateCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatErrorSupportAction } from '@/business/client/features/ChatErrorSupportAction';
import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useConversationStore } from '@/features/Conversation/store';

import { useFailedMessage } from './useFailedMessage';
import { useRetryParentMessage } from './useRetryParentMessage';

interface TraceIdErrorProps {
  error?: ChatMessageError | null;
  id: string;
  onRetry?: () => Promise<void> | void;
  showRetry?: boolean;
  traceId?: string;
}

const TraceIdError = memo<TraceIdErrorProps>(
  ({ error, id, onRetry, showRetry = true, traceId }) => {
    const { t } = useTranslation('error');
    const { disabled, loading, retryParentMessage } = useRetryParentMessage(id);
    const context = useConversationStore((s) => s.context);
    const message = useFailedMessage(id);

    const handleCopyTraceId = useCallback(async () => {
      if (!traceId) return;

      try {
        await copyToClipboard(traceId);
        toast.success(t('unknownError.copyTraceId'));
      } catch {
        /* noop */
      }
    }, [t, traceId]);

    const handleRetry = useCallback(() => {
      if (onRetry) {
        void onRetry();
        return;
      }

      void retryParentMessage();
    }, [onRetry, retryParentMessage]);

    return (
      <BaseErrorForm
        avatar={<Icon icon={AlertTriangle} size={24} />}
        title={t(showRetry ? 'unknownError.title' : 'unknownError.sharedTitle')}
        action={
          showRetry ? (
            <Flexbox horizontal gap={8}>
              <ChatErrorSupportAction
                agentId={context.agentId}
                error={error ?? message?.error}
                groupId={context.groupId ?? undefined}
                messageId={id}
                model={message?.model ?? undefined}
                provider={message?.provider ?? undefined}
                threadId={context.threadId ?? undefined}
                topicId={context.topicId ?? undefined}
                traceId={traceId}
              />
              <Button
                disabled={!onRetry && disabled}
                icon={<Icon icon={RotateCw} />}
                loading={!onRetry && loading}
                type={'primary'}
                onClick={handleRetry}
              >
                {t('unknownError.retry')}
              </Button>
            </Flexbox>
          ) : undefined
        }
        desc={
          <span>
            {t(showRetry ? 'unknownError.desc' : 'unknownError.sharedDesc')}{' '}
            <a
              href={SOCIAL_URL.discord}
              rel="noopener noreferrer"
              target="_blank"
              style={{
                alignItems: 'center',
                color: '#5865F2',
                display: 'inline-flex',
                gap: 2,
                verticalAlign: 'middle',
              }}
            >
              <Icon icon={DiscordIcon} size={14} />
              Discord
            </a>
            {traceId && (
              <>
                {' · '}
                {t('unknownError.traceIdLabel')}{' '}
                <code
                  title={t('unknownError.copyTraceIdTooltip')}
                  style={{
                    cursor: 'pointer',
                    opacity: 0.65,
                    textDecoration: 'underline dashed',
                    textDecorationColor: cssVar.colorTextQuaternary,
                    textUnderlineOffset: 3,
                  }}
                  onClick={handleCopyTraceId}
                >
                  {traceId}
                  <Icon icon={Copy} size={11} style={{ marginLeft: 3, verticalAlign: 'middle' }} />
                </code>
              </>
            )}
          </span>
        }
      />
    );
  },
);

export default TraceIdError;
