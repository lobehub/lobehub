import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { z } from 'zod';

import type {
  CancelUserResponseArgs,
  GetInteractionStateArgs,
  InteractionState,
  SkipUserResponseArgs,
  SubmitUserResponseArgs,
} from '../types';

const optionSchema = z.object({
  description: z.string(),
  label: z.string(),
});

const questionSchema = z.object({
  header: z.string(),
  multiSelect: z.boolean().optional(),
  options: z.array(optionSchema).min(2).max(4),
  question: z.string(),
});

const askUserQuestionArgsSchema = z.object({
  questions: z.array(questionSchema).min(1).max(4),
});

/** Opaque, process-local id for a pending interaction request. */
const generateRequestId = (): string =>
  `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class UserInteractionExecutionRuntime {
  private interactions: Map<string, InteractionState> = new Map();

  async askUserQuestion(args: unknown): Promise<BuiltinServerRuntimeOutput> {
    const parsed = askUserQuestionArgsSchema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      return {
        content: `Invalid askUserQuestion args:\n${issues.join('\n')}\nPlease regenerate the tool call with the correct schema.`,
        success: false,
      };
    }

    const requestId = generateRequestId();

    const state: InteractionState = {
      question: parsed.data,
      requestId,
      status: 'pending',
    };

    this.interactions.set(requestId, state);

    return {
      content: 'Question(s) presented to the user; awaiting response.',
      state,
      success: true,
    };
  }

  async submitUserResponse(args: SubmitUserResponseArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId, response } = args;
    const state = this.interactions.get(requestId);

    if (!state) {
      return { content: `Interaction not found: ${requestId}`, success: false };
    }

    if (state.status !== 'pending') {
      return {
        content: `Interaction ${requestId} is already ${state.status}, cannot submit.`,
        success: false,
      };
    }

    state.status = 'submitted';
    state.response = response;
    this.interactions.set(requestId, state);

    return {
      content: `User response submitted for interaction ${requestId}.`,
      state,
      success: true,
    };
  }

  async skipUserResponse(args: SkipUserResponseArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId, reason } = args;
    const state = this.interactions.get(requestId);

    if (!state) {
      return { content: `Interaction not found: ${requestId}`, success: false };
    }

    if (state.status !== 'pending') {
      return {
        content: `Interaction ${requestId} is already ${state.status}, cannot skip.`,
        success: false,
      };
    }

    state.status = 'skipped';
    state.skipReason = reason;
    this.interactions.set(requestId, state);

    return {
      content: `Interaction ${requestId} skipped.${reason ? ` Reason: ${reason}` : ''}`,
      state,
      success: true,
    };
  }

  async cancelUserResponse(args: CancelUserResponseArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId } = args;
    const state = this.interactions.get(requestId);

    if (!state) {
      return { content: `Interaction not found: ${requestId}`, success: false };
    }

    if (state.status !== 'pending') {
      return {
        content: `Interaction ${requestId} is already ${state.status}, cannot cancel.`,
        success: false,
      };
    }

    state.status = 'cancelled';
    this.interactions.set(requestId, state);

    return {
      content: `Interaction ${requestId} cancelled.`,
      state,
      success: true,
    };
  }

  async getInteractionState(args: GetInteractionStateArgs): Promise<BuiltinServerRuntimeOutput> {
    const { requestId } = args;
    const state = this.interactions.get(requestId);

    if (!state) {
      return { content: `Interaction not found: ${requestId}`, success: false };
    }

    return {
      content: `Interaction ${requestId} is ${state.status}.`,
      state,
      success: true,
    };
  }
}
