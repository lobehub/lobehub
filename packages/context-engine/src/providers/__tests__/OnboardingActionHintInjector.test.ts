import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { OnboardingActionHintInjector } from '../OnboardingActionHintInjector';
import type { OnboardingContext } from '../OnboardingContextInjector';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const buildProvider = (phaseGuidance: string, context?: Partial<OnboardingContext>) =>
  new OnboardingActionHintInjector({
    enabled: true,
    onboardingContext: {
      ...context,
      personaContent: '# Persona',
      phaseGuidance,
      soulContent: '# SOUL',
    },
  });

describe('OnboardingActionHintInjector', () => {
  describe('discovery turn reminder', () => {
    const phaseGuidance = 'Phase: Discovery. Explore the user world.';

    it('injects current discovery progress when more discovery turns are recommended', async () => {
      const provider = buildProvider(phaseGuidance, {
        discoveryUserMessageCount: 1,
        remainingDiscoveryExchanges: 2,
      });
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'I mostly write docs', role: 'user' },
        ]),
      );

      const last = result.messages.at(-1);
      expect(last?.content).toContain('SYSTEM REMINDER: Current Discovery turn status');
      expect(last?.content).toContain('User discovery exchanges observed: 1');
      expect(last?.content).toContain('Recommended target before Summary: 3');
      expect(last?.content).toContain('Continue Discovery for about 2 more user exchange(s)');
    });

    it('reminds the model to move toward summary after the recommended target is reached', async () => {
      const provider = buildProvider(phaseGuidance, {
        discoveryUserMessageCount: 3,
        remainingDiscoveryExchanges: 0,
      });
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'I need help with planning and writing', role: 'user' },
        ]),
      );

      const last = result.messages.at(-1);
      expect(last?.content).toContain('Recommended Discovery target has been reached');
      expect(last?.content).toContain('transition to Summary');
    });
  });

  describe('marketplace detection (Summary phase)', () => {
    const phaseGuidance = 'Phase: Summary. Wrap-up.';

    it('uses the not-opened branch when no prior showAgentMarketplace tool call exists', async () => {
      const provider = buildProvider(phaseGuidance);
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'hi', role: 'user' },
          { content: 'hello', role: 'assistant' },
        ]),
      );
      const last = result.messages.at(-1);
      expect(last?.role).toBe('user');
      expect(last?.content).toContain('THIS TURN call `showAgentMarketplace`');
      expect(last?.content).not.toContain('ALREADY opened');
    });

    it('detects DB-shape `tools` array with apiName=showAgentMarketplace', async () => {
      const provider = buildProvider(phaseGuidance);
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'hi', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tools: [
              {
                apiName: 'showAgentMarketplace',
                arguments: '{}',
                id: 'call_1',
                identifier: 'lobe-web-onboarding',
                type: 'default',
              },
            ],
          },
        ]),
      );
      const last = result.messages.at(-1);
      expect(last?.content).toContain('ALREADY opened');
      expect(last?.content).not.toContain('THIS TURN call `showAgentMarketplace`');
    });

    it('detects OpenAI-shape `tool_calls` array as a fallback', async () => {
      const provider = buildProvider(phaseGuidance);
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'hi', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: {
                  arguments: '{}',
                  name: 'lobe-web-onboarding____showAgentMarketplace____builtin',
                },
                id: 'call_1',
                type: 'function',
              },
            ],
          },
        ]),
      );
      const last = result.messages.at(-1);
      expect(last?.content).toContain('ALREADY opened');
    });

    it('does not flag unrelated tool calls', async () => {
      const provider = buildProvider(phaseGuidance);
      const result = await provider.process(
        createContext([
          { content: 'sys', role: 'system' },
          { content: 'hi', role: 'user' },
          {
            content: '',
            role: 'assistant',
            tools: [
              {
                apiName: 'saveUserQuestion',
                arguments: '{}',
                id: 'call_1',
                identifier: 'lobe-web-onboarding',
                type: 'default',
              },
            ],
          },
        ]),
      );
      const last = result.messages.at(-1);
      expect(last?.content).toContain('THIS TURN call `showAgentMarketplace`');
      expect(last?.content).not.toContain('ALREADY opened');
    });
  });
});
