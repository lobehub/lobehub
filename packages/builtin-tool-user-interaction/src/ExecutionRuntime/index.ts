import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { z } from 'zod';

import type {
  CancelUserResponseArgs,
  GetInteractionStateArgs,
  InteractionState,
  SkipUserResponseArgs,
  SubmitUserResponseArgs,
} from '../types';

const interactionFieldOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const interactionFieldSchema = z.object({
  key: z.string(),
  kind: z.enum(['multiselect', 'select', 'text', 'textarea']),
  label: z.string(),
  options: z.array(interactionFieldOptionSchema).optional(),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  value: z.union([z.string(), z.array(z.string())]).optional(),
});

const questionSchema = z
  .object({
    description: z.string().optional(),
    fields: z.array(interactionFieldSchema).optional(),
    id: z.string(),
    metadata: z.record(z.unknown()).optional(),
    mode: z.enum(['form', 'freeform']),
    prompt: z.string(),
  })
  .strict()
  .refine((q) => q.mode !== 'form' || (q.fields && q.fields.length > 0), {
    message:
      'Mode "form" requires a non-empty "fields" array. Use "freeform" mode for open-ended input, or provide "fields" for structured form input.',
  });

const askUserQuestionArgsSchema = z.object({
  question: questionSchema,
});

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

    const { question } = parsed.data;
    const requestId = question.id;

    const state: InteractionState = {
      question,
      requestId,
      status: 'pending',
    };

    this.interactions.set(requestId, state);

    return {
      content: `Question "${question.prompt}" is now pending user response.`,
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
