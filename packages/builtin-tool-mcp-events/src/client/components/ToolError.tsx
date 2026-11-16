'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { type McpEventsToolError, toolErrorDetails, toolErrorTitleKey } from '../toolError';

/**
 * A failed call as one readable line — what failed and what to do, by error
 * code — with the server's message folded behind "Show details". The raw text
 * often names the cause (the APP_URL in use, the connector's reply), so it
 * stays reachable instead of being dropped, but it is not the first thing a
 * person reads.
 */
const ToolError = memo<{ error: McpEventsToolError }>(({ error }) => {
  const { t } = useTranslation('plugin');

  return (
    <AsyncError
      align={'start'}
      details={toolErrorDetails(error)}
      title={t(toolErrorTitleKey(error.code) as any)}
      variant={'inline'}
    />
  );
});

ToolError.displayName = 'McpEventsToolError';

export default ToolError;
