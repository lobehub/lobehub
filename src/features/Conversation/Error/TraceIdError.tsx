import { SOCIAL_URL } from '@lobechat/business-const';
import { copyToClipboard, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { DiscordIcon } from '@lobehub/ui/icons';
import { message } from 'antd';
import { cssVar } from 'antd-style';
import { AlertTriangle, Copy, RotateCw } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';

import { useRetryParentMessage } from './useRetryParentMessage';

interface TraceIdErrorProps {
  id: string;
  traceId: string;
}

const TraceIdError = memo<TraceIdErrorProps>(({ id, traceId }) => {
  const { t } = useTranslation('error');
  const { disabled, loading, retryParentMessage } = useRetryParentMessage(id);

  const handleCopyTraceId = useCallback(async () => {
    try {
      await copyToClipboard(traceId);
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
          disabled={disabled}
          icon={<Icon icon={RotateCw} />}
          loading={loading}
          size={'small'}
          type={'primary'}
          onClick={() => retryParentMessage()}
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
        </span>
      }
    />
  );
});

export default TraceIdError;
