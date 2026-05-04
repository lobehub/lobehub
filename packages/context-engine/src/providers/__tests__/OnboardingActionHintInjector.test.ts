import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { OnboardingActionHintInjector } from '../OnboardingActionHintInjector';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] },
  isAborted: false,
  messages,
  metadata: {},
});

const buildProvider = (phaseGuidance: string) =>
  new OnboardingActionHintInjector({
    enabled: true,
    onboardingContext: {
      personaContent: '# Persona',
      phaseGuidance,
      soulContent: '# SOUL',
    },
  });

describe('OnboardingActionHintInjector', () => {
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
                identifier: 'lobe-agent-marketplace',
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
                  name: 'lobe-agent-marketplace____showAgentMarketplace____builtin',
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
