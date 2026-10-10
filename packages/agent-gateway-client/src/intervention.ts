import type {
  AgentInterventionInteractionKind,
  AgentInterventionProvider,
  AgentInterventionRenderArguments,
  AgentInterventionRenderOption,
  AgentInterventionRequestData,
} from './types';

const INTERACTION_KINDS = new Set<AgentInterventionInteractionKind>([
  'permission',
  'plan',
  'question',
]);
const PROVIDERS = new Set<AgentInterventionProvider>([
  'codex',
  'claude-code',
  'cursor',
  'devin',
  'droid',
  'qoder',
]);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const boundedString = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined;

/**
 * Reconstruct the only request payload that may cross the durable Review
 * boundary. Unknown keys and raw tool arguments are discarded, malformed or
 * ambiguous provider choices fail closed, and permission/plan option ids are
 * mandatory so a label can never be mistaken for provider consent.
 */
export const sanitizeAgentInterventionRequestForReview = (
  request: AgentInterventionRequestData | undefined,
): AgentInterventionRequestData | undefined => {
  const nativeCodex =
    request?.provider === 'codex' &&
    request.identifier === 'codex' &&
    request.interactionKind === 'permission' &&
    (request.apiName === 'command_execution' || request.apiName === 'file_change') &&
    !!boundedString(request.interventionId, 200);
  if (
    !request ||
    (request.apiName !== 'askUserQuestion' && !nativeCodex) ||
    !request.interactionKind ||
    !INTERACTION_KINDS.has(request.interactionKind) ||
    !request.provider ||
    !PROVIDERS.has(request.provider) ||
    !Number.isFinite(request.deadline)
  ) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(nativeCodex ? (request.reviewArguments ?? '') : request.arguments);
  } catch {
    return;
  }

  const rawQuestions = asRecord(parsed)?.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 4) return;
  if (request.interactionKind !== 'question' && rawQuestions.length !== 1) return;

  const questions: AgentInterventionRenderArguments['questions'] = [];
  const questionTexts = new Set<string>();
  for (const rawQuestion of rawQuestions) {
    const questionRecord = asRecord(rawQuestion);
    if (!questionRecord) return;

    const question = boundedString(questionRecord.question, 4000);
    const header = questionRecord.header === '' ? '' : boundedString(questionRecord.header, 200);
    const rawOptions = questionRecord.options;
    if (
      question === undefined ||
      header === undefined ||
      (questionRecord.multiSelect !== undefined &&
        typeof questionRecord.multiSelect !== 'boolean') ||
      (request.interactionKind !== 'question' && questionRecord.multiSelect === true) ||
      !Array.isArray(rawOptions) ||
      rawOptions.length < 1 ||
      rawOptions.length > 16
    ) {
      return;
    }
    if (questionTexts.has(question)) return;
    questionTexts.add(question);

    const options: AgentInterventionRenderOption[] = [];
    const optionIds = new Set<string>();
    for (const rawOption of rawOptions) {
      const optionRecord = asRecord(rawOption);
      const label = boundedString(optionRecord?.label, 200);
      const id = boundedString(optionRecord?.id, 200);
      const description =
        optionRecord?.description === undefined
          ? undefined
          : boundedString(optionRecord.description, 1000);
      if (
        !optionRecord ||
        !label ||
        (optionRecord.description !== undefined && description === undefined) ||
        (request.interactionKind !== 'question' && !id) ||
        (id !== undefined && optionIds.has(id))
      ) {
        return;
      }
      if (id) optionIds.add(id);
      options.push({ ...(description ? { description } : {}), ...(id ? { id } : {}), label });
    }

    questions.push({
      header,
      multiSelect: questionRecord.multiSelect === true,
      options,
      question,
    });
  }

  return {
    apiName: request.apiName,
    arguments: JSON.stringify({ questions } satisfies AgentInterventionRenderArguments),
    deadline: request.deadline,
    identifier: request.identifier,
    interactionKind: request.interactionKind,
    interventionId: request.interventionId,
    provider: request.provider,
    toolCallId: request.toolCallId,
  };
};

/**
 * Projects the producer's sealed permission choices onto a chat intervention.
 *
 * Use when:
 * - Applying a native callback to either a Desktop or device message.
 *
 * Expects:
 * - The original callback, including its canonical reviewArguments when present.
 *
 * Returns:
 * - The original option IDs; an invalid declared review fails closed to no grants.
 * - Undefined for legacy requests that do not declare canonical review arguments.
 */
export const getAgentInterventionReviewDecisionIds = (
  request: AgentInterventionRequestData,
): string[] | undefined => {
  if (request.reviewArguments === undefined) return;
  const reviewed = sanitizeAgentInterventionRequestForReview(request);
  if (!reviewed) return [];
  const arguments_: AgentInterventionRenderArguments = JSON.parse(reviewed.arguments);
  return arguments_.questions[0].options.flatMap((option) => (option.id ? [option.id] : []));
};
