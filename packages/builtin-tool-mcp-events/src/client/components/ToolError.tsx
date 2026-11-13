'use client';

import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type McpEventsToolError, toolErrorTitleKey } from '../toolError';

/**
 * A failed call, said plainly: a title per error code that names the cause
 * and the way forward, and the server's own message underneath for detail.
 */
const ToolError = memo<{ error: McpEventsToolError }>(({ error }) => {
  const { t } = useTranslation('plugin');

  return (
    <Alert
      showIcon
      description={error.message}
      title={t(toolErrorTitleKey(error.code) as any)}
      type={'error'}
      variant={'borderless'}
    />
  );
});

ToolError.displayName = 'McpEventsToolError';

export default ToolError;
