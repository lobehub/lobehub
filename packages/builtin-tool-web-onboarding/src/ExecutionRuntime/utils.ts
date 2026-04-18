import type { SaveUserQuestionField } from '@lobechat/types';

interface WebOnboardingToolActionResult {
  content?: string;
  error?: {
    message?: string;
    type?: string;
  };
  ignoredFields?: string[];
  savedFields?: string[];
  success: boolean;
  unchangedFields?: string[];
}

const FIELD_LABELS: Record<SaveUserQuestionField, string> = {
  agentEmoji: 'agent emoji',
  agentName: 'agent name',
  fullName: 'full name',
  interests: 'interests',
  responseLanguage: 'response language',
};

const formatNaturalList = (items: string[]) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const PHASE_GUIDANCE: Record<string, string> = {
  agent_identity:
    'Phase: Agent Identity. The agent has no name or personality yet. Introduce yourself as freshly awakened, discover your name, creature type, personality, and communication style through conversation. Update SOUL.md once the user settles on who you are.',
  discovery:
    'Phase: Discovery. User identity is established. Now explore their work style, tools, active projects, pain points, and how they want you to help. Collect interests and responseLanguage naturally. Update the persona document as you learn more.',
  summary:
    'Phase: Summary. All structured fields and documents are in good shape. Present a natural summary of what you learned about the user and how you can help. Ask for light confirmation, then call finishOnboarding.',
  user_identity:
    'Phase: User Identity. The agent has an identity. Now learn who the user is — their name, role, and what they do. Save fullName via saveUserQuestion when learned. Start building the persona document.',
};

interface OnboardingStateContext {
  discoveryUserMessageCount?: number;
  finished: boolean;
  missingStructuredFields: string[];
  phase: string;
  remainingDiscoveryExchanges?: number;
  topicId?: string;
  version?: number;
}

export const formatWebOnboardingStateMessage = (state: OnboardingStateContext) => {
  if (state.finished) return 'Onboarding is complete.';

  const phaseGuidance = PHASE_GUIDANCE[state.phase] || '';
  const parts: string[] = [
    phaseGuidance,
    'Questioning rule: prefer the `lobe-user-interaction____askUserQuestion____builtin` tool call for structured collection or explicit UI input. For natural exploratory questions, plain text is allowed.',
  ];

  if (state.remainingDiscoveryExchanges !== undefined && state.remainingDiscoveryExchanges > 0) {
    parts.push(
      `Recommended: ${state.remainingDiscoveryExchanges} more user exchange(s) before moving to summary. Do not rush — keep exploring different aspects of the user's work and life.`,
    );
  }

  if (state.missingStructuredFields.length > 0) {
    const missingFields = formatNaturalList(
      state.missingStructuredFields.map(
        (field) => FIELD_LABELS[field as SaveUserQuestionField] || field,
      ),
    );
    parts.push(`Structured fields still needed: ${missingFields}.`);
  }

  return parts.filter(Boolean).join('\n');
};

export const EMPTY_DOCUMENT_MESSAGES: Record<'persona' | 'soul', string> = {
  persona:
    'User persona document is empty. Use writeDocument to create an initial persona based on what you have learned about the user.',
  soul: 'SOUL.md is empty. Use writeDocument to write the agent identity once you have settled on a name, creature type, vibe, and emoji.',
};

export const createDocumentReadResult = (
  docType: 'persona' | 'soul',
  content: string | null | undefined,
  id: string | null | undefined,
) => {
  if (!content) {
    return {
      content: EMPTY_DOCUMENT_MESSAGES[docType],
      state: { content: null, id: id ?? null, type: docType },
      success: true,
    };
  }

  return {
    content,
    state: { content, id, type: docType },
    success: true,
  };
};

export const createWebOnboardingToolResult = <T extends WebOnboardingToolActionResult>(
  result: T,
) => {
  const isError = !result.success;
  const errorMessage =
    result.error?.message ||
    (isError
      ? typeof result.content === 'string'
        ? result.content
        : 'Web onboarding tool call failed.'
      : undefined);
  const errorType = result.error?.type || 'WebOnboardingToolError';
  const payload = {
    ...(result.ignoredFields ? { ignoredFields: result.ignoredFields } : {}),
    ...(result.savedFields ? { savedFields: result.savedFields } : {}),
    ...(result.unchangedFields ? { unchangedFields: result.unchangedFields } : {}),
    ...(errorMessage ? { error: { message: errorMessage, type: errorType } } : {}),
    isError,
    success: result.success,
  };
  const content =
    result.content || (errorMessage ? errorMessage : 'Web onboarding tool call completed.');

  return {
    content,
    ...(errorMessage ? { error: { body: result, message: errorMessage, type: errorType } } : {}),
    state: payload,
    success: result.success,
  };
};
