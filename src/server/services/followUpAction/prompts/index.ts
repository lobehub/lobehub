import type { FollowUpHint } from '@lobechat/types';

import { BASE_SYSTEM_PROMPT } from './base';
import { buildOnboardingAddendum } from './onboarding';

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
