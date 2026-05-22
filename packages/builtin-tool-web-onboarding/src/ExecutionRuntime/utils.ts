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
  customInterests: 'custom interests',
  fullName: 'full name',
  interests: 'interests',
};

const formatNaturalList = (items: string[]) => {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;

  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const PHASE_GUIDANCE: Record<string, string> = {
  agent_identity:
    'Phase: Agent Identity. The agent has no name or personality yet. Discover the assistant name/avatar first. Phrases such as "call you X", "your name is X", "叫你 X", or "你叫 X" refer to agentName; phrases such as "use Y as the avatar" or "头像用 Y" refer to agentEmoji. Do NOT copy user_info displayName/fullName/username into agentName, and do NOT save fullName in the same call as agentName/agentEmoji unless the user explicitly says that value is their own name. Update SOUL.md once the user settles on who the assistant is.',
  discovery:
    'Phase: Discovery. User identity is established. Ask one focused question — what the user does for work (their profession, role, or main occupation) — and record it in the persona document. Do NOT explore pain points, tools, goals, or interests, and do NOT call saveUserQuestion with interests. Once you have their profession, move to summary.',
  summary:
    "Phase: Summary. All structured fields and documents are in good shape. Two-step wrap up: (1) THIS or the current summary turn, present a natural summary of what you learned and call `showAgentMarketplace` exactly once with `{ requestId, categoryHints, prompt }` (1–3 MarketplaceCategory slugs picked from the user's profession and anything else they shared). Do not call `submitAgentPick` / `skipAgentPick` / `cancelAgentPick` yourself. (2) On the NEXT turn, briefly acknowledge whatever the user said, send a warm closing, and call `finishOnboarding`. Treat the user's text reply on that next turn as the resolution signal even if the picker is still in `pending` state — do not stall waiting for a UI event. Do not call `showAgentMarketplace` more than once.",
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
    'Questioning rule: prefer the `lobe-user-interaction____askUserQuestion` tool call for structured collection or explicit UI input. For natural exploratory questions, plain text is allowed.',
  ];

  if (
    state.phase === 'discovery' &&
    state.remainingDiscoveryExchanges !== undefined &&
    state.remainingDiscoveryExchanges > 0
  ) {
    const currentDiscoveryExchanges = state.discoveryUserMessageCount ?? 0;
    const recommendedTarget = currentDiscoveryExchanges + state.remainingDiscoveryExchanges;

    parts.push(
      `Discovery progress: ${currentDiscoveryExchanges}/${recommendedTarget} user exchange(s) observed since Discovery began.`,
    );
    parts.push(
      `Recommended: ${state.remainingDiscoveryExchanges} more user exchange(s) before moving to summary. Ask the user what they do for work if you have not yet, record it in the persona, then move on.`,
    );
  } else if (
    state.phase === 'discovery' &&
    state.discoveryUserMessageCount !== undefined &&
    state.remainingDiscoveryExchanges === 0
  ) {
    parts.push(
      `Discovery progress: recommended target reached after ${state.discoveryUserMessageCount} user exchange(s). Move to summary once the user's profession is recorded in the persona.`,
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
  const content = result.content || errorMessage || 'Web onboarding tool call completed.';

  return {
    content,
    ...(errorMessage ? { error: { body: result, message: errorMessage, type: errorType } } : {}),
    state: payload,
    success: result.success,
  };
};
