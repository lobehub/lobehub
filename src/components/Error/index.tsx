'use client';

import { Button, Collapse, Flexbox, FluentEmoji, Highlighter } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';

export type ErrorType = Error & { digest?: string };

interface ErrorCaptureProps {
  error: ErrorType;
  reset: () => void;
}

const ErrorCapture = ({ error, reset }: ErrorCaptureProps) => {
  const { t } = useTranslation('error');
  const hasStack = !!error?.stack;
  const defaultStackKeys = typeof __CI__ !== 'undefined' && __CI__ ? ['stack'] : [];

  return (
    <Flexbox align={'center'} justify={'center'} style={{ minHeight: '100dvh', width: '100%' }}>
      <h1
        style={{
          filter: 'blur(8px)',
          fontSize: `min(${MAX_WIDTH / 6}px, 25vw)`,
          fontWeight: 900,
          margin: 0,
          opacity: 0.12,
          position: 'absolute',
          zIndex: 0,
        }}
      >
        ERROR
      </h1>
      <FluentEmoji emoji={'🤧'} size={64} />
      <h2 style={{ fontWeight: 'bold', marginTop: '1em', textAlign: 'center' }}>
        {t('error.title')}
      </h2>
      <p style={{ marginBottom: '2em' }}>{t('error.desc')}</p>
      {hasStack && (
        <Collapse
          defaultActiveKey={defaultStackKeys}
          expandIconPlacement={'end'}
          size={'small'}
          style={{ marginBottom: '1em', maxWidth: '90vw', width: 560 }}
          variant={'borderless'}
          items={[
            {
              children: (
                <Highlighter language={'plaintext'} padding={8} variant={'borderless'}>
                  {error.stack!}
                </Highlighter>
              ),
              key: 'stack',
              label: t('error.stack'),
            },
          ]}
        />
      )}
      <Flexbox horizontal gap={12} style={{ marginBottom: '1em' }}>
        <Button onClick={() => reset()}>{t('error.retry')}</Button>
        <Button type={'primary'} onClick={() => (window.location.href = '/')}>
          {t('error.backHome')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

export default ErrorCapture;
