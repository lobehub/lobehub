import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { OnboardingContextInjector } from '../OnboardingContextInjector';

describe('OnboardingContextInjector', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  it('should inject onboarding context before the first user message', async () => {
    const provider = new OnboardingContextInjector({
      enabled: true,
      onboardingContext: {
        personaContent: '# Persona',
        phaseGuidance: '<phase>collect-profile</phase>',
        soulContent: '# SOUL',
      },
    });

    const result = await provider.process(
      createContext([
        { content: 'System role', role: 'system' },
        { content: 'Hello', role: 'user' },
      ]),
    );

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe('System role');
    // Injected message before first user message
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('<onboarding_context>');
    expect(result.messages[1].content).toContain('<phase>collect-profile</phase>');
    expect(result.messages[1].content).toContain('<current_soul_document>');
    expect(result.messages[1].content).toContain('<current_user_persona>');
    // Original user message preserved
    expect(result.messages[2].content).toBe('Hello');
  });

  it('should prefix soul and persona content with 1-based line numbers', async () => {
    const provider = new OnboardingContextInjector({
      enabled: true,
      onboardingContext: {
        personaContent: 'Line A\nLine B\n',
        phaseGuidance: '<phase>collect-profile</phase>',
        soulContent: '# SOUL\n\n## Identity\nname: Cat\n',
      },
    });

    const result = await provider.process(
      createContext([
        { content: 'System role', role: 'system' },
        { content: 'Hello', role: 'user' },
      ]),
    );

    const injected = result.messages[1].content as string;
    expect(injected).toMatch(/ 1→# SOUL/);
    expect(injected).toMatch(/ 3→## Identity/);
    expect(injected).toMatch(/ 4→name: Cat/);
    expect(injected).toMatch(/ 1→Line A/);
    expect(injected).toMatch(/ 2→Line B/);
    // Should not contain trailing phantom empty numbered line
    expect(injected).not.toMatch(/ 5→\n<\/current_soul_document>/);
  });

  it('should skip reinjection when onboarding context already exists in messages', async () => {
    const provider = new OnboardingContextInjector({
      enabled: true,
      onboardingContext: {
        phaseGuidance: '<phase>collect-profile</phase>',
      },
    });

    const result = await provider.process(
      createContext([
        { content: 'Hello', role: 'user' },
        {
          content: '<onboarding_context>\n<phase>existing</phase>\n</onboarding_context>',
          meta: { injectType: 'OnboardingContextInjector', virtualLastUser: true },
          role: 'user',
        },
      ]),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toContain('<phase>existing</phase>');
  });
});
