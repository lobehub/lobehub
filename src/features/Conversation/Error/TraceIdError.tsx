import { SOCIAL_URL } from '@lobechat/business-const';
import { Icon } from '@lobehub/ui';
import { DiscordIcon } from '@lobehub/ui/icons';
import { Button, message } from 'antd';
import { cssVar } from 'antd-style';
import { AlertTriangle, Copy, RotateCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useConversationStore } from '@/features/Conversation/store';

interface TraceIdErrorProps {
  id: string;
  traceId: string;
}

const TraceIdError = memo<TraceIdErrorProps>(({ id, traceId }) => {
  const { t } = useTranslation('error');
  const [loading, setLoading] = useState(false);

  const regenerateUserMessage = useConversationStore((s) => s.regenerateUserMessage);
  const parentId = useConversationStore(
    (s) => s.displayMessages.find((m) => m.id === id)?.parentId,
  );

  const handleRetry = useCallback(async () => {
    if (!parentId) return;

    setLoading(true);
    try {
      await regenerateUserMessage(parentId);
    } finally {
      setLoading(false);
    }
  }, [parentId, regenerateUserMessage]);

  const handleCopyTraceId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(traceId);
      message.success(t('unknownError.copyTraceId'));
    } catch {
      /* noop */
    }
  }, [t, traceId]);

  return (
    <BaseErrorForm
      avatar={<Icon icon={AlertTriangle} size={24} />}
      title={t('unknownError.title')}
      action={
        <Button
          icon={<Icon icon={RotateCw} />}
          loading={loading}
          size={'small'}
          type={'primary'}
          onClick={handleRetry}
        >
          {t('unknownError.retry')}
        </Button>
      }
      desc={
        <span>
          {t('unknownError.desc')}{' '}
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
          {' · Trace ID: '}
          <code
            title="Click to copy"
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
        </span>
      }
    />
  );
});

export default TraceIdError;
