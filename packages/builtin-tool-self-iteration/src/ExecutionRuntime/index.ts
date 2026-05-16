import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DeclareSelfFeedbackIntentContext,
  DeclareSelfFeedbackIntentInput,
  DeclareSelfFeedbackIntentPayload,
  DeclareSelfFeedbackIntentResult,
  DeclareSelfFeedbackIntentState,
} from '../types';

export interface SelfFeedbackIntentRuntimeService {
  declareIntent: (
    input: DeclareSelfFeedbackIntentInput,
  ) => Promise<DeclareSelfFeedbackIntentResult>;
}

export interface SelfFeedbackIntentExecutionRuntimeOptions {
  service: SelfFeedbackIntentRuntimeService;
}

const REQUIRED_CONTEXT_KEYS = ['agentId', 'userId', 'topicId'];

const createJsonOutput = (
  state: DeclareSelfFeedbackIntentState,
  success: boolean,
): BuiltinServerRuntimeOutput => ({
  content: JSON.stringify(state),
  state,
  success,
});

export class SelfFeedbackIntentExecutionRuntime {
  private service: SelfFeedbackIntentRuntimeService;

  constructor(options: SelfFeedbackIntentExecutionRuntimeOptions) {
    this.service = options.service;
  }

  declareSelfFeedbackIntent = async (
    input: DeclareSelfFeedbackIntentPayload,
    context: DeclareSelfFeedbackIntentContext = {},
  ): Promise<BuiltinServerRuntimeOutput> => {
    const { agentId, operationId, toolCallId, topicId, userId } = context;

    if (!agentId || !userId || !topicId) {
      return createJsonOutput(
        {
          accepted: false,
          reason: 'missing_context',
          required: REQUIRED_CONTEXT_KEYS,
        },
        false,
      );
    }

    try {
      const result = await this.service.declareIntent({
        agentId,
        input,
        topicId,
        userId,
        ...(operationId ? { operationId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      });

      return createJsonOutput(
        {
          accepted: result.accepted,
          reason: result.reason ?? null,
          sourceId: result.sourceId ?? null,
          strength: result.strength,
        },
        true,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown self-feedback intent error';

      return {
        content: `declareSelfFeedbackIntent with error detail: ${message}`,
        error: { message },
        state: {
          accepted: false,
          reason: 'runtime_error',
        } satisfies DeclareSelfFeedbackIntentState,
        success: false,
      };
    }
  };
}
