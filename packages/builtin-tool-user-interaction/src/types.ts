export const UserInteractionIdentifier = 'lobe-user-interaction';

export const UserInteractionApiName = {
  askUserQuestion: 'askUserQuestion',
  cancelUserResponse: 'cancelUserResponse',
  getInteractionState: 'getInteractionState',
  skipUserResponse: 'skipUserResponse',
  submitUserResponse: 'submitUserResponse',
} as const;

export type InteractionMode = 'form' | 'freeform';

export type InteractionStatus = 'cancelled' | 'pending' | 'skipped' | 'submitted';

export interface InteractionFieldOption {
  label: string;
  value: string;
}

export interface InteractionField {
  key: string;
  kind: 'multiselect' | 'select' | 'text' | 'textarea';
  label: string;
  options?: InteractionFieldOption[];
  placeholder?: string;
  required?: boolean;
  value?: string | string[];
}

export interface AskUserQuestionArgs {
  question: {
    description?: string;
    fields?: InteractionField[];
    id: string;
    metadata?: Record<string, unknown>;
    mode: InteractionMode;
    prompt: string;
  };
}

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
  question?: AskUserQuestionArgs['question'];
  requestId: string;
  response?: Record<string, unknown>;
  skipReason?: string;
  status: InteractionStatus;
}

export type UserInteractionResult =
  | { requestId: string; response: Record<string, unknown>; type: 'submitted' }
  | { reason?: string; requestId: string; type: 'skipped' }
  | { requestId: string; type: 'cancelled' };
