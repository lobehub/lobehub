import type { AskUserQuestionArgs } from '@lobechat/shared-tool-ui/ask-user';

export const UserInteractionIdentifier = 'lobe-user-interaction';

export const UserInteractionApiName = {
  askUserQuestion: 'askUserQuestion',
  cancelUserResponse: 'cancelUserResponse',
  getInteractionState: 'getInteractionState',
  skipUserResponse: 'skipUserResponse',
  submitUserResponse: 'submitUserResponse',
} as const;

export type InteractionStatus = 'cancelled' | 'pending' | 'skipped' | 'submitted';

/**
 * The AskUserQuestion data model is shared with Claude Code and lobe-agent — it
 * lives in `@lobechat/shared-tool-ui/ask-user`. Re-exported here so consumers
 * get the argument types from this package's single import surface.
 */
export type {
  AskUserDraft,
  AskUserQuestionArgs,
  AskUserQuestionItem,
  AskUserQuestionOption,
} from '@lobechat/shared-tool-ui/ask-user';

export interface SubmitUserResponseArgs {
  requestId: string;
  response: Record<string, unknown>;
}

export interface SkipUserResponseArgs {
  reason?: string;
  requestId: string;
}

export interface CancelUserResponseArgs {
  requestId: string;
}

export interface GetInteractionStateArgs {
  requestId: string;
}

export interface InteractionState {
  /** The whole `{ questions }` payload presented to the user. */
  question?: AskUserQuestionArgs;
  requestId: string;
  response?: Record<string, unknown>;
  skipReason?: string;
  status: InteractionStatus;
}

export type UserInteractionResult =
  | { requestId: string; response: Record<string, unknown>; type: 'submitted' }
  | { reason?: string; requestId: string; type: 'skipped' }
  | { requestId: string; type: 'cancelled' };
