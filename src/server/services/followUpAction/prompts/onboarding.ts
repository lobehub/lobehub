import type { OnboardingPhase } from '@lobechat/types';

const PHASE_TIPS: Record<OnboardingPhase, string> = {
  agent_identity: 'Suggestions can be candidate agent names, emojis, or a deferral chip ("You pick one", "Let me think").',
  user_identity: 'Suggestions can be plausible names or roles, or a deferral chip.',
  discovery: 'Suggestions can be common pain points, interests, work styles, or a chip like "Let me explain in my own words".',
  summary: 'Skip — handled by the marketplace picker; you should not be invoked here.',
};

export const buildOnboardingAddendum = (phase: OnboardingPhase): string =>
  [
    `This is an onboarding conversation. Phase: ${phase}.`,
    `Phase tip: ${PHASE_TIPS[phase]}`,
  ].join('\n');
