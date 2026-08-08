import {
  type ClassifiedLLMError,
  createLLMErrorClassifier,
  type LLMErrorKind,
} from '@lobechat/agent-runtime';
import { ERROR_CODE_SPECS, getErrorCodeSpec } from '@lobechat/model-runtime';

export const classifyLLMError = createLLMErrorClassifier({
  errorCodeSpecs: Object.values(ERROR_CODE_SPECS),
  getErrorCodeSpec,
});

export type { ClassifiedLLMError, LLMErrorKind };
