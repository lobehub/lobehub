import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { OnboardingSyntheticStateInjector } from '../OnboardingSyntheticStateInjector';
import type { OnboardingContext } from '../OnboardingContextInjector';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const buildProvider = (context?: Partial<OnboardingContext>) =>
  new OnboardingSyntheticStateInjector({
    enabled: true,
    onboardingContext: {
      personaContent: '# Persona',
      phaseGuidance: 'Phase: Discovery. Explore the user world.',
      soulContent: '# SOUL',
      ...context,
    },
  });

describe('OnboardingSyntheticStateInjector', () => {
  it.each([
    ['finished undefined', undefined],
    ['finished false', false],
  ])(
    'injects synthetic getOnboardingState pair when onboarding is active with %s',
    async (_, finished) => {
      const provider = buildProvider({ finished });

      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'I mostly write docs', role: 'user' },
        ]),
      );

      expect(result.messages).toHaveLength(4);
      expect(result.messages[2].role).toBe('assistant');
      expect(result.messages[2].tool_calls?.[0]?.function?.name).toBe(
        'lobe-web-onboarding____getOnboardingState',
      );
      expect(result.messages[3].role).toBe('tool');
      expect(result.messages[3].content).toContain('Phase: Discovery');
      expect(result.messages[3].content).toContain('<current_soul_document>');
      expect(result.messages[3].content).toContain('<current_user_persona>');
    },
  );

  it('skips synthetic getOnboardingState pair when onboarding is finished', async () => {
    const provider = buildProvider({
      finished: true,
      phaseGuidance: 'Onboarding is complete.',
    });

    const result = await provider.process(
      createContext([
        { content: 'sys', role: 'system' },
        { content: 'Unrelated follow-up', role: 'user' },
      ]),
    );

    expect(result.messages).toHaveLength(2);
    expect(
      result.messages.some(
        (message) =>
          message.role === 'tool' ||
          message.tool_calls?.some(
            (toolCall: any) =>
              toolCall?.function?.name === 'lobe-web-onboarding____getOnboardingState',
          ),
      ),
    ).toBe(false);
  });
});
