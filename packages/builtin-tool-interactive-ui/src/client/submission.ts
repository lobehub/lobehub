import { InteractiveUIApiName, InteractiveUIIdentifier } from '../types';

export const MAX_FOLLOW_UP_LENGTH = 2_000;

export const getFollowUpDraftValidation = (text: string) => ({
  canSend: text.trim().length > 0 && text.length <= MAX_FOLLOW_UP_LENGTH,
  tooLong: text.length > MAX_FOLLOW_UP_LENGTH,
});

interface SubmissionContext {
  busy: boolean;
  currentContextKey: string;
  originalContextKey: string;
  readOnly: boolean;
  source?: { plugin?: { apiName?: string; identifier?: string }; role: string };
  target: { contextKey: string; writable: true } | { writable: false };
}

/** No destination can come from the generated widget. Recheck the host on every click. */
export const canSubmitInteractiveUI = (context: SubmissionContext): boolean =>
  !context.readOnly &&
  !context.busy &&
  context.currentContextKey === context.originalContextKey &&
  context.target.writable &&
  context.target.contextKey === context.originalContextKey &&
  context.source?.role === 'tool' &&
  context.source.plugin?.identifier === InteractiveUIIdentifier &&
  context.source.plugin?.apiName === InteractiveUIApiName.renderUI;

export const formatInteractiveUIFollowUp = (
  title: string,
  messageId: string,
  text: string,
): string => `[Interactive UI: ${title}; source tool message: ${messageId}]\n${text.trim()}`;
