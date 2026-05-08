// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

import {
  classifySkillIntent,
  classifySkillIntentByRules,
  SkillIntentClassifierAgentService,
} from '../skillIntent';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('skillIntent classifier', () => {
  const mockGenerateObject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
      generateObject: mockGenerateObject,
    } as never);
  });

  /**
   * @example
   * explicit artifact conversion is semantic and goes through the fallback model.
   */
  it('does not hard-code explicit SKILL.md conversion with deterministic rules', () => {
    const result = classifySkillIntentByRules({
      message:
        'The SKILL.md draft from the chat agent is usable. Convert it into a real skills/bundle.',
      serializedContext: 'topic=repo-review',
    });

    expect(result).toBeUndefined();
  });

  /**
   * @example
   * named skill edits are semantic and go through the fallback model.
   */
  it('does not hard-code named skill edit requests with deterministic rules', () => {
    const result = classifySkillIntentByRules({
      message: 'Update review-skill to include security checks and rollback checks.',
      serializedContext: 'topic=repo-review',
    });

    expect(result).toBeUndefined();
  });

  /**
   * @example
   * natural-language praise and durable reuse wording goes through semantic fallback.
   */
  it('does not hard-code natural-language durable reuse with deterministic rules', async () => {
    const fallback = {
      classify: vi.fn().mockResolvedValue({
        actionIntent: 'create',
        confidence: 0.86,
        explicitness: 'implicit_strong_learning',
        reason: 'semantic classifier recognized durable procedure retention intent',
        route: 'direct_decision',
      }),
    };

    const ruleResult = classifySkillIntentByRules({
      message: 'Nice work. Can we keep this workflow?',
      serializedContext: 'topic=youtube-comment-workflow',
    });
    const result = await classifySkillIntent(
      {
        message: 'Nice work. Can we keep this workflow?',
        serializedContext: 'topic=youtube-comment-workflow',
      },
      { fallback },
    );

    expect(ruleResult).toBeUndefined();
    expect(fallback.classify).toHaveBeenCalledWith({
      message: 'Nice work. Can we keep this workflow?',
      serializedContext: 'topic=youtube-comment-workflow',
      topicLabel: 'youtube-comment-workflow',
    });
    expect(result).toEqual({
      actionIntent: 'create',
      confidence: 0.86,
      explicitness: 'implicit_strong_learning',
      reason: 'semantic classifier recognized durable procedure retention intent',
      route: 'direct_decision',
    });
  });

  /**
   * @example
   * negative future preference is semantic and goes through the fallback model.
   */
  it('does not hard-code negative future preference with deterministic rules', () => {
    const result = classifySkillIntentByRules({
      message: 'This approach is not suitable. Please do not do this again.',
      serializedContext: 'topic=database-migration',
    });

    expect(result).toBeUndefined();
  });

  /**
   * @example
   * implicit strong learning goes through the injected fallback classifier.
   */
  it('uses fallback classifier for implicit strong learning instructions', async () => {
    const fallback = {
      classify: vi.fn().mockResolvedValue({
        actionIntent: 'create',
        confidence: 0.86,
        explicitness: 'implicit_strong_learning',
        reason: 'future-scoped procedural reuse instruction',
        route: 'direct_decision',
      }),
    };

    const result = await classifySkillIntent(
      {
        message: 'For future database migration reviews, follow the checklist from earlier.',
        serializedContext: 'topic=database-migration-review',
      },
      { fallback },
    );

    expect(fallback.classify).toHaveBeenCalledWith({
      message: 'For future database migration reviews, follow the checklist from earlier.',
      serializedContext: 'topic=database-migration-review',
      topicLabel: 'database-migration-review',
    });
    expect(result).toEqual({
      actionIntent: 'create',
      confidence: 0.86,
      explicitness: 'implicit_strong_learning',
      reason: 'future-scoped procedural reuse instruction',
      route: 'direct_decision',
    });
  });

  /**
   * @example
   * injected fallback classifiers may omit actionIntent for non-skill routes.
   */
  it('accepts fallback classifier output without optional action intent', async () => {
    const fallback = {
      classify: vi.fn().mockResolvedValue({
        confidence: 0.84,
        explicitness: 'non_skill_preference',
        reason: 'durable preference outside skill management',
        route: 'non_skill',
      }),
    };

    const result = await classifySkillIntent(
      {
        message: 'For future code reviews, use shorter comments.',
        serializedContext: 'topic=code-review',
      },
      { fallback },
    );

    expect(result).toEqual({
      confidence: 0.84,
      explicitness: 'non_skill_preference',
      reason: 'durable preference outside skill management',
      route: 'non_skill',
    });
  });

  /**
   * @example
   * invalid fallback output falls back to safe accumulation instead of direct mutation.
   */
  it('falls back safely when fallback classifier throws a malformed output error', async () => {
    const diagnostics = {
      recordMalformedOutput: vi.fn().mockResolvedValue(undefined),
    };
    const classifierError = new Error('provider returned invalid key: sk-testsecret123456789');
    (classifierError as Error & { cause?: unknown }).cause = new Error('HTTP 401 unauthorized');
    const fallback = {
      classify: vi.fn().mockRejectedValue(classifierError),
    };

    const result = await classifySkillIntent(
      {
        message: 'For future database migration reviews, follow the checklist from earlier.',
        serializedContext: 'topic=database-migration-review',
      },
      {
        diagnostics,
        fallback,
        scopeKey: 'topic:thread_1',
        sourceId: 'source_1',
      },
    );

    expect(result).toEqual({
      actionIntent: 'maintain',
      classifierError: {
        cause: 'HTTP 401 unauthorized',
        message: 'provider returned invalid key: [redacted-key]',
        name: 'Error',
      },
      confidence: 0.35,
      explicitness: 'weak_positive',
      reason: 'insufficient-evidence',
      route: 'accumulate',
    });
    expect(diagnostics.recordMalformedOutput).toHaveBeenCalledWith({
      error: expect.any(Error),
      reason: 'malformed skill-intent classifier output',
      scopeKey: 'topic:thread_1',
      sourceId: 'source_1',
      stage: 'skill-intent',
    });
  });

  /**
   * @example
   * weak-positive classifier output cannot directly mutate skills even if the model asks for it.
   */
  it('falls back safely when fallback classifier returns an inconsistent direct-decision route', async () => {
    const diagnostics = {
      recordMalformedOutput: vi.fn().mockResolvedValue(undefined),
    };
    const fallback = {
      classify: vi.fn().mockResolvedValue({
        actionIntent: 'create',
        confidence: 0.9,
        explicitness: 'weak_positive',
        reason: 'model mixed weak evidence with direct mutation',
        route: 'direct_decision',
      }),
    };

    const result = await classifySkillIntent(
      {
        message: 'Nice work.',
        serializedContext: 'topic=youtube-comment-workflow',
      },
      {
        diagnostics,
        fallback,
        scopeKey: 'topic:thread_1',
        sourceId: 'source_1',
      },
    );

    expect(result).toEqual({
      actionIntent: 'maintain',
      classifierError: {
        message: expect.stringContaining('Weak-positive skill intent must accumulate'),
        name: 'ZodError',
      },
      confidence: 0.35,
      explicitness: 'weak_positive',
      reason: 'insufficient-evidence',
      route: 'accumulate',
    });
    expect(diagnostics.recordMalformedOutput).toHaveBeenCalledWith({
      error: expect.any(Error),
      reason: 'malformed skill-intent classifier output',
      scopeKey: 'topic:thread_1',
      sourceId: 'source_1',
      stage: 'skill-intent',
    });
  });

  /**
   * @example
   * the model-backed fallback receives compact context only.
   */
  it('uses the model-backed fallback with compact structured schema', async () => {
    mockGenerateObject.mockResolvedValue({
      actionIntent: 'create',
      confidence: 0.88,
      explicitness: 'implicit_strong_learning',
      reason: 'stable future-use procedure instruction',
      route: 'direct_decision',
    });

    const service = new SkillIntentClassifierAgentService({} as LobeChatDatabase, 'user_1', {
      model: 'gpt-test',
      provider: 'openai',
    });
    const result = await service.classify({
      message: 'This troubleshooting procedure is stable. Use it for future login failures.',
      serializedContext: 'topic=login-debugging;tool_outcome=createDocument',
      topicLabel: 'login-debugging',
    });

    expect(initModelRuntimeFromDB).toHaveBeenCalledWith({} as LobeChatDatabase, 'user_1', 'openai');
    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Classify skill intent for Agent Signal'),
            role: 'system',
          }),
          expect.objectContaining({
            content: expect.stringContaining('"topicLabel":"login-debugging"'),
            role: 'user',
          }),
        ],
        model: 'gpt-test',
      }),
      { metadata: { trigger: RequestTrigger.AgentSignal } },
    );
    expect(result).toEqual({
      actionIntent: 'create',
      confidence: 0.88,
      explicitness: 'implicit_strong_learning',
      reason: 'stable future-use procedure instruction',
      route: 'direct_decision',
    });
  });
});
