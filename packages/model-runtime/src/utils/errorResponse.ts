import type { ErrorResponse, ErrorType } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';

import type { ILobeAgentRuntimeErrorType } from '../types';
import { AgentRuntimeErrorType } from '../types';

const getStatus = (errorType: ILobeAgentRuntimeErrorType | ErrorType) => {
  // InvalidAccessCode / InvalidAzureAPIKey / InvalidOpenAIAPIKey / InvalidZhipuAPIKey ....
  if (errorType.toString().includes('Invalid')) return 401;

  switch (errorType) {
    case AgentRuntimeErrorType.InvalidProviderAPIKey: {
      return 401;
    }

    case AgentRuntimeErrorType.ExceededContextWindow: {
      return 400;
    }

    case AgentRuntimeErrorType.LocationNotSupportError: {
      return 403;
    }

    case AgentRuntimeErrorType.ModelNotFound: {
      return 404;
    }

    case AgentRuntimeErrorType.InsufficientQuota:
    case AgentRuntimeErrorType.QuotaLimitReached: {
      return 429;
    }

    // define the 471~480 as provider error
    case AgentRuntimeErrorType.AgentRuntimeError: {
      return 470;
    }

    case AgentRuntimeErrorType.ProviderBizError: {
      return 471;
    }

    // all local provider connection error
    case AgentRuntimeErrorType.OllamaServiceUnavailable:
    case ChatErrorType.OllamaServiceUnavailable:
    case AgentRuntimeErrorType.OllamaBizError: {
      return 472;
    }
  }

  return errorType as number;
};

export const createErrorResponse = (errorType: ILobeAgentRuntimeErrorType, body?: any) => {
  const statusCode = getStatus(errorType);

  const data: ErrorResponse = { body, errorType };

  if (typeof statusCode !== 'number' || statusCode < 200 || statusCode > 599) {
    console.error(
      `current StatusCode: \`${statusCode}\` .`,
      'Please go to `./utils/errorResponse.ts` to defined the statusCode.',
    );
  }

  return new Response(JSON.stringify(data), { status: statusCode });
};
