'use client';

import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { toolErrorDetails, toolErrorTitleKey, type WebhookToolError } from '../toolError';

/**
 * A failed call as one readable line — what failed and what to do, by error code — with the
 * server's message folded behind "Show details".
 */
const ToolError = ({ error }: { error: WebhookToolError }) => {
  const { t } = useTranslation('plugin');

  return (
    <AsyncError
      align={'start'}
      details={toolErrorDetails(error)}
      title={t(toolErrorTitleKey(error.code))}
      variant={'inline'}
    />
  );
};

export default ToolError;
