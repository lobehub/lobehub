'use client';

import { Alert, Highlighter } from '@lobehub/ui';
import { type ErrorInfo, memo } from 'react';

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
      extra={
        error?.stack ? (
          <Highlighter actionIconSize="small" language="plaintext" padding={8} variant="borderless">
            {error.stack}
          </Highlighter>
        ) : undefined
      }
      extraIsolate={false}
      message={error?.message || 'An unknown error occurred'}
      showIcon
      style={{
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
      title={title}
      type="secondary"
    />
  );
});

ErrorDisplay.displayName = 'ToolErrorDisplay';
