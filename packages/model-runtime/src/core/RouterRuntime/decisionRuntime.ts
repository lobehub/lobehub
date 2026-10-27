import { AgentRuntimeErrorType } from '@lobechat/types';

import type {
  DecisionOptions,
  DecisionPayload,
  DecisionQuestions,
  DecisionResponse,
} from '../../types';
import { AgentRuntimeError } from '../../utils/createError';
import type { LobeRuntimeAI } from '../BaseAI';

export const runDecision = async <Q extends DecisionQuestions>(
  runtime: LobeRuntimeAI,
  payload: DecisionPayload<Q>,
  options: DecisionOptions | undefined,
  provider: string,
): Promise<DecisionResponse<Q>> => {
  // Route options pick runtimes by apiType, but most runtimes cannot serve decision models.
  if (!runtime.decide) {
    throw AgentRuntimeError.chat({
      error: new Error('Decision models are not supported by the matched runtime'),
      errorType: AgentRuntimeErrorType.CapabilityNotSupported,
      provider,
    });
  }

  return runtime.decide(payload, options);
};
