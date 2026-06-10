import type { FollowUpHint } from '@lobechat/types';

import { BASE_SYSTEM_PROMPT } from './base';
import { buildOnboardingAddendum } from './onboarding';

/**
 * Bump when editing BASE_SYSTEM_PROMPT, the onboarding addendum, or the
 * suggestion response schema. The 6-char prompt hash in the tracing row
 * catches forgotten bumps.
 */
export const FOLLOW_UP_PROMPT_VERSION = 'v1.0';

export interface BuiltPrompt {
  system: string;
  user: string;
}

export const buildSuggestionPrompt = (params: {
  assistantText: string;
  hint?: FollowUpHint;
}): BuiltPrompt => {
  const { assistantText, hint } = params;

  const sections = [BASE_SYSTEM_PROMPT];

  if (hint?.kind === 'onboarding') {
    sections.push(buildOnboardingAddendum(hint.phase));
  }

  return {
    system: sections.join('\n\n'),
    user: `Last assistant message:\n"""\n${assistantText.trim()}\n"""`,
  };
};

export { BASE_SYSTEM_PROMPT };
