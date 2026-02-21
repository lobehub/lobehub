'use client';

import { Alert, Highlighter } from '@lobehub/ui';
import { type ErrorInfo } from 'react';
import { memo } from 'react';

interface ErrorDisplayProps {
  apiName?: string;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  identifier?: string;
}

/**
 * Error display component using @lobehub/ui Alert
 */
export const ErrorDisplay = memo<ErrorDisplayProps>(({ error, identifier, apiName }) => {
  const title = identifier ? `${identifier}${apiName ? ` / ${apiName}` : ''}` : 'Tool Render Error';

  return (
    <Alert
      showIcon
      extraIsolate={false}
      message={error?.message || 'An unknown error occurred'}
      title={title}
      type="secondary"
      extra={
        error?.stack ? (
          <Highlighter actionIconSize="small" language="plaintext" padding={8} variant="borderless">
            {error.stack}
          </Highlighter>
        ) : undefined
      }
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    />
  );
});

ErrorDisplay.displayName = 'ToolErrorDisplay';
