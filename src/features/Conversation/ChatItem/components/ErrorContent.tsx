import { Alert, Skeleton } from '@lobehub/ui';
import { Button } from 'antd';
import { RotateCcw } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { useConversationStore } from '@/features/Conversation';

import { type ChatItemProps } from '../type';

export interface ErrorContentProps {
  customErrorRender?: ChatItemProps['customErrorRender'];
  error: ChatItemProps['error'];
  id?: string;
  onRegenerate?: () => void;
}

const ErrorContent = memo<ErrorContentProps>(({ customErrorRender, error, id, onRegenerate }) => {
  const { t } = useTranslation('common');
  const [deleteMessage] = useConversationStore((s) => [s.deleteMessage]);

  if (!error) return;

  if (customErrorRender) {
    return (
      <Suspense fallback={<Skeleton.Button active block />}>{customErrorRender(error)}</Suspense>
    );
  }

  return (
    <Alert
      closable
      extraDefaultExpand
      showIcon
      extraIsolate={false}
      type={'secondary'}
      action={
        onRegenerate && (
          <Button
            color="default"
            icon={<RotateCcw size={14} />}
            size="small"
            variant="filled"
            onClick={onRegenerate}
          >
            {t('regenerate')}
          </Button>
        )
      }
      {...error}
      title={error.message}
      afterClose={() => {
        error?.afterClose?.();
        if (id) {
          deleteMessage(id);
        }
      }}
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        ...error.style,
      }}
    />
  );
});

export default ErrorContent;
