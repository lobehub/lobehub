'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { lazy, memo, Suspense } from 'react';

const Highlighter = lazy(() => import('@lobehub/ui/es/Highlighter/index'));

interface AlertFallbackProps {
  error: Error;
  resetErrorBoundary: (...args: unknown[]) => void;
  title?: string;
}

const AlertFallback = memo<AlertFallbackProps>(({ error, resetErrorBoundary, title }) => {
  return (
    <Alert
      closable
      showIcon
      extraIsolate={false}
      message={error?.message || 'An unknown error occurred'}
      style={{ overflow: 'hidden', position: 'relative', width: '100%' }}
      title={title || 'Render Error'}
      type="secondary"
      extra={
        error?.stack ? (
          <Suspense fallback={null}>
            <Highlighter
              actionIconSize="small"
              language="plaintext"
              padding={8}
              variant="borderless"
            >
              {error.stack}
            </Highlighter>
          </Suspense>
        ) : undefined
      }
      onClose={resetErrorBoundary}
    />
  );
});

AlertFallback.displayName = 'AlertFallback';

export default AlertFallback;
