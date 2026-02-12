import { type ChatMessageError } from '@lobechat/types';
import { type AlertProps } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import dynamic from '@/libs/next/dynamic';

const loading = () => <Skeleton active style={{ width: 300 }} />;

const SetupGuide = dynamic(() => import('../OllamaSetupGuide'), { loading, ssr: false });

const InvalidModel = dynamic(() => import('./InvalidOllamaModel'), { loading, ssr: false });

interface OllamaError {
  code: string | null;
  message: string;
  param?: any;
  type: string;
}

interface OllamaErrorResponse {
  error: OllamaError;
}

const UNRESOLVED_MODEL_REGEXP = /model "([\w+,-_]+)" not found/;

interface OllamaBizErrorProps {
  alertError?: AlertProps;
  error?: ChatMessageError | null;
  id: string;
}

const OllamaBizError = memo<OllamaBizErrorProps>(({ alertError, error, id }) => {
  const errorBody: OllamaErrorResponse = (error as any)?.body;

  const errorMessage = errorBody.error?.message;

  // error of not pull the model
  const unresolvedModel = errorMessage?.match(UNRESOLVED_MODEL_REGEXP)?.[1];
  if (unresolvedModel) {
    return <InvalidModel id={id} model={unresolvedModel} />;
  }

  // error of not enable model or not set the CORS rules
  if (errorMessage?.includes('Failed to fetch')) {
    return <SetupGuide id={id} />;
  }

  return <ErrorContent error={alertError} id={id} />;
});

export default OllamaBizError;
