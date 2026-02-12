'use client';

import { Button, Flexbox, FluentEmoji } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';

export type ErrorType = Error & { digest?: string };

interface ErrorCaptureProps {
  error: ErrorType;
  reset: () => void;
}

const ErrorCapture = memo<ErrorCaptureProps>(({ reset }) => {
  const { t } = useTranslation('error');

  return (
    <Flexbox align={'center'} justify={'center'} style={{ minHeight: '100%', width: '100%' }}>
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
      <Flexbox horizontal gap={12} style={{ marginBottom: '1em' }}>
        <Button onClick={() => reset()}>{t('error.retry')}</Button>
        <Button type={'primary'} onClick={() => (window.location.href = '/')}>
          {t('error.backHome')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

ErrorCapture.displayName = 'ErrorCapture';

export default ErrorCapture;
