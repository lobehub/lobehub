// @vitest-environment node
import type { SourceAgentUserMessage } from '@lobechat/agent-signal/source';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SignalFeedbackSatisfaction } from '../../policies/types';
import { createRuntimeProcessorContext } from '../../runtime/context';
import { classifyDomain, classifySatisfaction } from '../classifiers';

const context = createRuntimeProcessorContext({
  backend: {
    async getGuardState() {
      return {};
    },
    async touchGuardState() {
      return {};
    },
  },
  now: () => 1234,
  scopeKey: 'topic:thread_1',
});

const createUserMessageSource = (
  input: Partial<{
    message: string;
    sourceId: string;
  }> = {},
): SourceAgentUserMessage => ({
  chain: {
    chainId: `chain:${input.sourceId ?? 'source_1'}`,
    rootSourceId: input.sourceId ?? 'source_1',
  },
  payload: {
    agentId: 'agent_1',
    documentPayload: { section: 'style' },
    intents: ['document', 'memory'],
    memoryPayload: { shouldRemember: true },
    message: input.message ?? '  Please keep replies tighter.  ',
    messageId: `msg:${input.sourceId ?? 'source_1'}`,
    serializedContext: 'topic=repo-review',
    topicId: 'topic_1',
  },
  scopeKey: 'topic:thread_1',
  sourceId: input.sourceId ?? 'source_1',
  sourceType: 'agent.user.message',
  timestamp: 1,
});

const createSatisfactionSignal = (
  input: Partial<SignalFeedbackSatisfaction['payload']> = {},
): SignalFeedbackSatisfaction => ({
  chain: {
    chainId: 'chain:source_1',
    parentNodeId: 'source_1',
    rootSourceId: 'source_1',
  },
  payload: {
    agentId: 'agent_1',
    confidence: 0.9,
    evidence: [{ cue: 'prefer', excerpt: 'I prefer concise code review.' }],
    message: 'I prefer concise code review.',
    messageId: 'msg:source_1',
    reason: 'durable preference',
    result: 'not_satisfied',
    sourceHints: { intents: ['memory', 'skill'] },
    topicId: 'topic_1',
    ...input,
  },
  signalId: 'source_1:signal:feedback-satisfaction',
  signalType: 'signal.feedback.satisfaction',
  source: {
    sourceId: 'source_1',
    sourceType: 'agent.user.message',
  },
  timestamp: 1,
});

const createZodError = () => {
  const result = z.object({ value: z.string() }).safeParse({});

  if (result.success) {
    throw new Error('Expected test schema parsing to fail.');
  }

  return result.error;
};

describe('classifier processors', () => {
  /**
   * @example
   * classifySatisfaction(userMessage, context, service) trims the message and returns one satisfaction signal.
   */
  it('turns service output into a feedback satisfaction signal with trimmed message and source hints', async () => {
    const classify = vi.fn().mockResolvedValue({
      confidence: 0.94,
      evidence: [{ cue: 'too long', excerpt: 'Please keep replies tighter.' }],
      reason: 'explicit style feedback',
      result: 'not_satisfied',
    });
    const source = createUserMessageSource();

    const result = await classifySatisfaction(source, context, {
      satisfactionClassifier: { classify },
    });

    expect(classify).toHaveBeenCalledWith({
      message: 'Please keep replies tighter.',
      serializedContext: 'topic=repo-review',
    });
    expect(result).toEqual({
      reason: 'classified feedback satisfaction',
      type: 'continue',
      value: expect.objectContaining({
        chain: {
          chainId: 'chain:source_1',
          parentNodeId: 'source_1',
          rootSourceId: 'source_1',
        },
        payload: expect.objectContaining({
          agentId: 'agent_1',
          message: 'Please keep replies tighter.',
          messageId: 'msg:source_1',
          serializedContext: 'topic=repo-review',
          sourceHints: {
            documentPayload: { section: 'style' },
            intents: ['document', 'memory'],
            memoryPayload: { shouldRemember: true },
          },
          topicId: 'topic_1',
        }),
        signalId: 'source_1:signal:feedback-satisfaction',
        signalType: 'signal.feedback.satisfaction',
        source: {
          sourceId: 'source_1',
          sourceType: 'agent.user.message',
        },
        timestamp: 1234,
      }),
    });
  });

  /**
   * @example
   * classifyDomain(satisfaction, context, service) fans out memory and skill domain signals.
   */
  it('can return multiple domain signals with target-specific signal types', async () => {
    const classify = vi.fn().mockResolvedValue([
      {
        confidence: 0.86,
        evidence: [],
        reason: 'future personal preference',
        target: 'memory',
      },
      {
        confidence: 0.78,
        evidence: [{ cue: 'template', excerpt: 'reusable template' }],
        reason: 'reusable workflow idea',
        target: 'skill',
      },
    ]);
    const signal = createSatisfactionSignal();

    const result = await classifyDomain(signal, context, {
      domainClassifier: { classify },
    });

    expect(classify).toHaveBeenCalledWith(signal);
    expect(result).toEqual({
      reason: 'classified feedback domains',
      type: 'continue',
      value: [
        expect.objectContaining({
          payload: expect.objectContaining({
            conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 100 },
            evidence: signal.payload.evidence,
            satisfactionResult: 'not_satisfied',
            target: 'memory',
          }),
          signalId: 'source_1:signal:feedback-satisfaction:domain:memory',
          signalType: 'signal.feedback.domain.memory',
          timestamp: 1234,
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            conflictPolicy: { forbiddenWith: ['none'], mode: 'fanout', priority: 80 },
            evidence: [{ cue: 'template', excerpt: 'reusable template' }],
            satisfactionResult: 'not_satisfied',
            target: 'skill',
          }),
          signalId: 'source_1:signal:feedback-satisfaction:domain:skill',
          signalType: 'signal.feedback.domain.skill',
          timestamp: 1234,
        }),
      ],
    });
  });

  /**
   * @example
   * classifyDomain(satisfaction, context, service) preserves an explicit none target.
   */
  it('can return an explicit none domain signal', async () => {
    const classify = vi.fn().mockResolvedValue([
      {
        confidence: 0.91,
        evidence: [],
        reason: 'non-actionable feedback',
        target: 'none',
      },
    ]);
    const signal = createSatisfactionSignal();

    const result = await classifyDomain(signal, context, {
      domainClassifier: { classify },
    });

    expect(result).toEqual({
      reason: 'classified feedback domains',
      type: 'continue',
      value: [
        expect.objectContaining({
          payload: expect.objectContaining({
            conflictPolicy: {
              forbiddenWith: ['memory', 'prompt', 'skill'],
              mode: 'exclusive',
              priority: 0,
            },
            evidence: signal.payload.evidence,
            satisfactionResult: 'not_satisfied',
            target: 'none',
          }),
          signalId: 'source_1:signal:feedback-satisfaction:domain:none',
          signalType: 'signal.feedback.domain.none',
          timestamp: 1234,
        }),
      ],
    });
  });

  /**
   * @example
   * classifyDomain(neutralSignal, context, service) stops before invoking the classifier.
   */
  it('stops when the satisfaction result is neutral', async () => {
    const classify = vi.fn();

    const result = await classifyDomain(createSatisfactionSignal({ result: 'neutral' }), context, {
      domainClassifier: { classify },
    });

    expect(classify).not.toHaveBeenCalled();
    expect(result).toEqual({
      reason: 'neutral feedback satisfaction',
      result: { concluded: { reason: 'neutral feedback satisfaction' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * classifyDomain(signal, context, emptyService) stops with a reason for empty fanout.
   */
  it('stops when no feedback domains are classified', async () => {
    const classify = vi.fn().mockResolvedValue([]);

    const result = await classifyDomain(createSatisfactionSignal(), context, {
      domainClassifier: { classify },
    });

    expect(result).toEqual({
      reason: 'no feedback domains classified',
      result: { concluded: { reason: 'no feedback domains classified' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * classifyDomain(signal, context, {}) stops with an explicit no-op result.
   */
  it('stops with an explicit no-op when a classifier service is missing', async () => {
    const result = await classifyDomain(createSatisfactionSignal(), context, {});

    expect(result).toEqual({
      reason: 'domain classifier unavailable',
      result: { concluded: { reason: 'domain classifier unavailable' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * classifySatisfaction(source, context, malformedService).result.status === "conclude"
   */
  it('downgrades malformed satisfaction classifier output to a skipped no-op and records diagnostics', async () => {
    const error = createZodError();
    const recordMalformedOutput = vi.fn(async () => {});
    const source = createUserMessageSource();

    const result = await classifySatisfaction(source, context, {
      diagnostics: { recordMalformedOutput },
      satisfactionClassifier: {
        classify: vi.fn().mockRejectedValue(error),
      },
    });

    expect(recordMalformedOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        reason: 'malformed satisfaction classifier output',
        scopeKey: 'topic:thread_1',
        sourceId: 'source_1',
        stage: 'satisfaction',
      }),
    );
    expect(result).toEqual({
      reason: 'malformed satisfaction classifier output',
      result: {
        concluded: {
          reason: 'malformed satisfaction classifier output',
        },
        status: 'conclude',
      },
      type: 'stop',
    });
  });

  /**
   * @example
   * classifyDomain(signal, context, malformedService).result.status === "conclude"
   */
  it('downgrades malformed domain classifier output to a skipped no-op and records diagnostics', async () => {
    const error = createZodError();
    const recordMalformedOutput = vi.fn(async () => {});
    const signal = createSatisfactionSignal();

    const result = await classifyDomain(signal, context, {
      diagnostics: { recordMalformedOutput },
      domainClassifier: {
        classify: vi.fn().mockRejectedValue(error),
      },
    });

    expect(recordMalformedOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        error,
        reason: 'malformed domain classifier output',
        scopeKey: 'topic:thread_1',
        signalId: 'source_1:signal:feedback-satisfaction',
        sourceId: 'source_1',
        stage: 'domain',
      }),
    );
    expect(result).toEqual({
      reason: 'malformed domain classifier output',
      result: {
        concluded: {
          reason: 'malformed domain classifier output',
        },
        status: 'conclude',
      },
      type: 'stop',
    });
  });

  /**
   * @example
   * classifyDomain(signal, context, providerOutageService) rejects the provider outage.
   */
  it('does not swallow non-malformed classifier service errors', async () => {
    const error = new Error('provider temporarily unavailable');

    await expect(
      classifyDomain(createSatisfactionSignal(), context, {
        domainClassifier: {
          classify: vi.fn().mockRejectedValue(error),
        },
      }),
    ).rejects.toThrow(error);
  });
});
