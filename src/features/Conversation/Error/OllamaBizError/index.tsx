import { type ChatMessageError } from '@lobechat/types';
import { type AlertProps, Skeleton } from '@lobehub/ui';
import { memo } from 'react';

import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import dynamic from '@/libs/next/dynamic';

import { getOllamaErrorMessage, getUnresolvedOllamaModel } from './parseOllamaError';

const loading = () => <Skeleton style={{ width: 300 }} />;

const SetupGuide = dynamic(() => import('../OllamaSetupGuide'), { loading, ssr: false });

const InvalidModel = dynamic(() => import('./InvalidOllamaModel'), { loading, ssr: false });

interface OllamaBizErrorProps {
  alertError?: AlertProps;
  error?: ChatMessageError | null;
  id: string;
}

const OllamaBizError = memo<OllamaBizErrorProps>(({ alertError, error, id }) => {
  const errorMessage = getOllamaErrorMessage(error);

  // error of not pull the model
  const unresolvedModel = getUnresolvedOllamaModel(error);
  if (unresolvedModel) {
    return <InvalidModel id={id} model={unresolvedModel} />;
  }

  // error of not enable model or not set the CORS rules
  if (errorMessage?.includes('Failed to fetch')) {
    return <SetupGuide id={id} />;
  }

  // Without the alert the message would render empty.
  return <ErrorContent error={alertError ?? { message: errorMessage, type: 'error' }} id={id} />;
});

export default OllamaBizError;
