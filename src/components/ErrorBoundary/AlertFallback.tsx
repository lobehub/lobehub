'use client';

import { Alert, Highlighter } from '@lobehub/ui';
import { memo } from 'react';

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
          <Highlighter actionIconSize="small" language="plaintext" padding={8} variant="borderless">
            {error.stack}
          </Highlighter>
        ) : undefined
      }
      onClose={resetErrorBoundary}
    />
  );
});

AlertFallback.displayName = 'AlertFallback';

export default AlertFallback;
