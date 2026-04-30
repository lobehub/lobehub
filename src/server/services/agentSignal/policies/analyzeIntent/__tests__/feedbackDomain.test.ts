// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createRuntimeProcessorContext } from '../../../runtime/context';
import { createFeedbackDomainJudgeSignalHandler } from '../feedbackDomain';

const context = createRuntimeProcessorContext({
  backend: {
    async getGuardState() {
      return {};
    },
    async touchGuardState() {
      return {};
    },
  },
  scopeKey: 'topic:thread_1',
});

describe('feedbackDomainJudge', () => {
  it('routes assistant phrasing corrections to the prompt lane', async () => {
    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async () => [
        {
          confidence: 0.97,
          evidence: [
            {
              cue: 'stop saying',
              excerpt: 'Stop saying "Below is a detailed analysis" before every answer.',
            },
          ],
          reason: 'assistant self-wording rule',
          target: 'prompt',
        },
      ],
    });
    const result = await handler.handle(
      {
        chain: { chainId: 'chain_1', parentNodeId: 'source_1', rootSourceId: 'source_1' },
        payload: {
          confidence: 0.9,
          evidence: [{ cue: 'wrong', excerpt: 'wrong' }],
          message: 'Stop saying "Below is a detailed analysis" before every answer.',
          messageId: 'msg_1',
          reason: 'corrective-feedback-cue',
          result: 'not_satisfied',
          serializedContext: '{"should":"not be forwarded to domain signals"}',
          sourceHints: { documentPayload: { patch: true } },
        },
        signalId: 'sig_1',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              sourceHints: { documentPayload: { patch: true } },
              target: 'prompt',
            }),
            signalType: 'signal.feedback.domain.prompt',
          }),
        ],
      }),
    );
  });

  it('allows multi-target fanout for memory plus skill signals', async () => {
    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async () => [
        {
          confidence: 0.86,
          evidence: [
            {
              cue: 'i prefer',
              excerpt:
                'Going forward, in code review I prefer concise file-specific suggestions and a reusable template.',
            },
          ],
          reason: 'future personal preference for code review',
          target: 'memory',
        },
        {
          confidence: 0.78,
          evidence: [
            {
              cue: 'template',
              excerpt:
                'Going forward, in code review I prefer concise file-specific suggestions and a reusable template.',
            },
          ],
          reason: 'reusable template idea',
          target: 'skill',
        },
      ],
    });
    const result = await handler.handle(
      {
        chain: { chainId: 'chain_2', parentNodeId: 'source_2', rootSourceId: 'source_2' },
        payload: {
          confidence: 0.9,
          evidence: [{ cue: 'prefer', excerpt: 'prefer' }],
          message:
            'Going forward, in code review I prefer concise file-specific suggestions and a reusable template.',
          messageId: 'msg_2',
          reason: 'corrective-feedback-cue',
          result: 'not_satisfied',
          sourceHints: { memoryPayload: { saved: true } },
        },
        signalId: 'sig_2',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_2', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toEqual(
      expect.objectContaining({
        signals: expect.arrayContaining([
          expect.objectContaining({ signalType: 'signal.feedback.domain.memory' }),
          expect.objectContaining({ signalType: 'signal.feedback.domain.skill' }),
        ]),
      }),
    );
  });

  it('does not invoke domain routing for neutral satisfaction results', async () => {
    let invocationCount = 0;

    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async () => {
        invocationCount += 1;

        return [
          {
            confidence: 0.95,
            evidence: [{ cue: 'thanks', excerpt: 'Thanks.' }],
            reason: 'should not happen',
            target: 'none',
          },
        ];
      },
    });

    const result = await handler.handle(
      {
        chain: {
          chainId: 'chain_neutral',
          parentNodeId: 'source_neutral',
          rootSourceId: 'source_neutral',
        },
        payload: {
          confidence: 0.91,
          evidence: [{ cue: 'thanks', excerpt: 'Thanks.' }],
          message: 'Thanks.',
          messageId: 'msg_neutral',
          reason: 'acknowledgement-only',
          result: 'neutral',
          sourceHints: { intents: ['memory'] },
        },
        signalId: 'sig_neutral',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_neutral', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(invocationCount).toBe(0);
    expect(result).toBeUndefined();
  });

  it('dispatches a none domain signal when a non-neutral resolver returns none', async () => {
    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async () => [
        {
          confidence: 0.81,
          evidence: [],
          reason: 'non-actionable feedback',
          target: 'none',
        },
      ],
    });

    const result = await handler.handle(
      {
        chain: {
          chainId: 'chain_none',
          parentNodeId: 'source_none',
          rootSourceId: 'source_none',
        },
        payload: {
          confidence: 0.89,
          evidence: [{ cue: 'commentary', excerpt: 'That was interesting.' }],
          message: 'That was interesting.',
          messageId: 'msg_none',
          reason: 'commentary-only',
          result: 'satisfied',
          sourceHints: { intents: ['prompt'] },
        },
        signalId: 'sig_none',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_none', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toEqual(
      expect.objectContaining({
        signals: [
          expect.objectContaining({
            payload: expect.objectContaining({
              conflictPolicy: {
                forbiddenWith: ['memory', 'prompt', 'skill'],
                mode: 'exclusive',
                priority: 0,
              },
              evidence: [{ cue: 'commentary', excerpt: 'That was interesting.' }],
              target: 'none',
            }),
            signalType: 'signal.feedback.domain.none',
          }),
        ],
      }),
    );
  });

  it('passes structured satisfaction output to the resolver without serialized context', async () => {
    let resolverInput:
      | Parameters<
          NonNullable<
            NonNullable<
              Parameters<typeof createFeedbackDomainJudgeSignalHandler>[0]
            >['resolveDomains']
          >
        >[0]
      | undefined;

    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async (input) => {
        resolverInput = input;

        return [
          {
            confidence: 0.86,
            evidence: [
              {
                cue: 'i prefer',
                excerpt: 'Going forward, I prefer concise file-specific review comments.',
              },
            ],
            reason: 'durable user preference',
            target: 'memory',
          },
        ];
      },
    });

    await handler.handle(
      {
        chain: {
          chainId: 'chain_structured',
          parentNodeId: 'source_structured',
          rootSourceId: 'source_structured',
        },
        payload: {
          confidence: 0.88,
          evidence: [
            {
              cue: 'prefer',
              excerpt: 'Going forward, I prefer concise file-specific review comments.',
            },
          ],
          message: 'Going forward, I prefer concise file-specific review comments.',
          messageId: 'msg_structured',
          reason: 'corrective-feedback-cue',
          result: 'not_satisfied',
          serializedContext: '{"large":"context"}',
          sourceHints: { intents: ['memory'] },
          topicId: 'topic_structured',
        },
        signalId: 'sig_structured',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_structured', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(resolverInput).toEqual({
      chain: {
        chainId: 'chain_structured',
        parentNodeId: 'source_structured',
        rootSourceId: 'source_structured',
      },
      feedback: {
        confidence: 0.88,
        evidence: [
          {
            cue: 'prefer',
            excerpt: 'Going forward, I prefer concise file-specific review comments.',
          },
        ],
        message: 'Going forward, I prefer concise file-specific review comments.',
        messageId: 'msg_structured',
        reason: 'corrective-feedback-cue',
        result: 'not_satisfied',
      },
      source: { sourceId: 'source_structured', sourceType: 'agent.user.message' },
      sourceHints: { intents: ['memory'] },
      topicId: 'topic_structured',
    });
  });

  it('keeps satisfied reinforcement out of the memory lane when only non-memory domains are returned', async () => {
    const handler = createFeedbackDomainJudgeSignalHandler({
      resolveDomains: async () => [
        {
          confidence: 0.83,
          evidence: [
            {
              cue: 'reusable template',
              excerpt: 'This workflow is much better and should become our reusable template.',
            },
          ],
          reason: 'reusable template suggestion',
          target: 'skill',
        },
      ],
    });
    const result = await handler.handle(
      {
        chain: { chainId: 'chain_3', parentNodeId: 'source_3', rootSourceId: 'source_3' },
        payload: {
          confidence: 0.9,
          evidence: [{ cue: 'much better', excerpt: 'much better' }],
          message: 'This workflow is much better and should become our reusable template.',
          messageId: 'msg_3',
          reason: 'positive-reinforcement-cue',
          result: 'satisfied',
          sourceHints: { intents: ['memory'] },
        },
        signalId: 'sig_3',
        signalType: 'signal.feedback.satisfaction',
        source: { sourceId: 'source_3', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toEqual(
      expect.objectContaining({
        signals: expect.arrayContaining([
          expect.objectContaining({ signalType: 'signal.feedback.domain.skill' }),
        ]),
      }),
    );
    expect(result).not.toEqual(
      expect.objectContaining({
        signals: expect.arrayContaining([
          expect.objectContaining({ signalType: 'signal.feedback.domain.memory' }),
        ]),
      }),
    );
  });
});
