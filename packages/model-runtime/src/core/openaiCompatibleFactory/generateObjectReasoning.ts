import {
  isGPTProResponsesModel,
  supportsGPTResponsesReasoningEffortNone,
} from '../../providers/openai/modelId';
import type { GenerateObjectPayload } from '../../types';

type GenerateObjectReasoningParams = Pick<GenerateObjectPayload, 'reasoning_effort' | 'thinking'>;
export const getGenerateObjectReasoningParams = ({
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams) =>
  reasoning_effort && thinking?.type !== 'disabled' ? { reasoning_effort } : {};

export const getGenerateObjectResponsesReasoningParams = ({
  model,
  reasoning_effort,
  thinking,
}: GenerateObjectReasoningParams & { model: string }) => {
  if (isGPTProResponsesModel(model)) {
    return reasoning_effort && reasoning_effort !== 'max' ? { reasoning: { effort: 'high' } } : {};
  }

  if (thinking?.type === 'disabled') {
    return supportsGPTResponsesReasoningEffortNone(model) ? { reasoning: { effort: 'none' } } : {};
  }

  return reasoning_effort && reasoning_effort !== 'max'
    ? { reasoning: { effort: reasoning_effort } }
    : {};
};
