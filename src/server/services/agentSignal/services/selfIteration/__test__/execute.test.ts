// @vitest-environment node
import type { ChatMethodOptions, ChatStreamPayload, ModelRuntime } from '@lobechat/model-runtime';
import type * as ModelRuntimeModule from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import type { MessageToolCall, ModelUsage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunResult } from '../execute';
import { createAgentRunner, executeSelfIteration } from '../execute';
import type { NightlyReviewContext } from '../review/collect';
import type { ToolSet, ToolWriteResult } from '../tools/shared';
import { createToolSet } from '../tools/shared';
import { ActionStatus, ApplyMode, ReviewRunStatus, Risk, Scope } from '../types';

vi.mock('@lobechat/model-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelRuntimeModule>();

  return {
    ...actual,
    consumeStreamUntilDone: vi.fn(async () => undefined),
  };
});

const reviewContext = {
  agentId: 'agent-1',
  documentActivity: {
    ambiguousBucket: [],
    excludedSummary: { count: 0, reasons: [] },
    generalDocumentBucket: [],
    skillBucket: [],
  },
  feedbackActivity: {
    neutralCount: 0,
    notSatisfied: [],
    satisfied: [],
  },
  selfReviewSignals: [],
  managedSkills: [],
  proposalActivity: {
    active: [],
    dismissedCount: 0,
    expiredCount: 0,
    staleCount: 0,
    supersededCount: 0,
  },
  receiptActivity: {
    appliedCount: 0,
    duplicateGroups: [],
    failedCount: 0,
    pendingProposalCount: 0,
    recentReceipts: [],
    reviewCount: 0,
  },
  relevantMemories: [],
  reviewWindowEnd: '2026-05-04T14:00:00.000Z',
  reviewWindowStart: '2026-05-03T14:00:00.000Z',
  selfFeedbackCandidates: [],
  toolActivity: [],
  topics: [],
  userId: 'user-1',
} satisfies NightlyReviewContext;

interface MockChatStep {
  content: string;
  toolCalls?: MessageToolCall[];
  usage?: ModelUsage;
}

const createMockModelRuntime = (steps: MockChatStep[]) => {
  const chat = vi.fn(async (_payload: ChatStreamPayload, options?: ChatMethodOptions) => {
    const step = steps[Math.min(chat.mock.calls.length - 1, steps.length - 1)];

    options?.callback?.onText?.(step.content);
    options?.callback?.onToolsCalling?.({
      chunk: [],
      toolsCalling: step.toolCalls ?? [],
    });
    options?.callback?.onCompletion?.({ text: step.content, usage: step.usage });

    return new Response('');
  });

  return {
    chat,
    modelRuntime: { chat: chat as unknown as Pick<ModelRuntime, 'chat'>['chat'] },
  };
};

const createNoopTools = () =>
  createToolSet({
    reserveOperation: vi.fn(async () => ({ reserved: true as const })),
    writeReceipt: vi.fn(async () => ({ receiptId: 'receipt-1' })),
  });

const createMockTools = (writeResult?: ToolWriteResult): ToolSet => ({
  closeSelfReviewProposal: vi.fn(async () => ({
    receiptId: 'receipt-close',
    status: 'applied' as const,
  })),
  createSelfReviewProposal: vi.fn(async () => ({
    receiptId: 'receipt-proposal',
    status: 'proposed' as const,
  })),
  createSkillIfAbsent: vi.fn(
    async () =>
      writeResult || {
        receiptId: 'receipt-skill',
        resourceId: 'skill-1',
        status: 'applied' as const,
        summary: 'Created skill.',
      },
  ),
  getEvidenceDigest: vi.fn(async () => ({ evidence: [] })),
  getManagedSkill: vi.fn(async () => ({ id: 'skill-1' })),
  listSelfReviewProposals: vi.fn(async () => []),
  listManagedSkills: vi.fn(async () => []),
  readSelfReviewProposal: vi.fn(async () => undefined),
  refreshSelfReviewProposal: vi.fn(async () => ({
    receiptId: 'receipt-refresh',
    status: 'proposed' as const,
  })),
  replaceSkillContentCAS: vi.fn(async () => ({
    receiptId: 'receipt-replace',
    status: 'applied' as const,
  })),
  supersedeSelfReviewProposal: vi.fn(async () => ({
    receiptId: 'receipt-supersede',
    status: 'applied' as const,
  })),
  writeMemory: vi.fn(
    async () =>
      writeResult || {
        receiptId: 'receipt-memory',
        resourceId: 'memory-1',
        status: 'applied' as const,
        summary: 'Wrote memory.',
      },
  ),
});

describe('executeSelfIteration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * @example
   * expect(tools.createSkillIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
   * expect(result.writeOutcomes).toEqual([{ toolName: 'createSkillIfAbsent', result: writeResult }]);
   */
  it('invokes a write tool, records its outcome, and asks the model for a follow-up step', async () => {
    const writeResult = {
      receiptId: 'receipt-skill',
      resourceId: 'skill-1',
      status: 'applied',
      summary: 'Created skill.',
    } satisfies ToolWriteResult;
    const tools = createMockTools(writeResult);
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'I will create the skill.',
        toolCalls: [
          {
            function: {
              arguments: JSON.stringify({
                bodyMarkdown: '# Skill',
                idempotencyKey: 'source-1:create-skill',
                name: 'debug-skill',
                summary: 'Create a debug skill.',
              }),
              name: 'createSkillIfAbsent',
            },
            id: 'tool-call-1',
            type: 'function',
          },
        ],
        usage: { inputTextTokens: 10, outputTextTokens: 5, totalTokens: 15 },
      },
      {
        content: 'Created the skill.',
        usage: { inputTextTokens: 5, outputTextTokens: 3, totalTokens: 8 },
      },
    ]);

    const result = await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 5,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    expect(tools.createSkillIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyMarkdown: '# Skill',
        idempotencyKey: 'source-1:create-skill',
        name: 'debug-skill',
        userId: 'user-1',
      }),
    );
    expect(chat).toHaveBeenCalledTimes(2);
    expect(consumeStreamUntilDone).toHaveBeenCalledTimes(2);
    expect(result.stepCount).toBeGreaterThan(1);
    expect(result.content).toContain('Created the skill.');
    expect(result.writeOutcomes).toEqual([
      { result: writeResult, toolName: 'createSkillIfAbsent' },
    ]);
  });

  /**
   * @example
   * expect(tools.writeMemory).toHaveBeenCalledWith(expect.objectContaining({ content: 'User prefers concise summaries.' }));
   * expect(result.writeOutcomes[0]).toMatchObject({ toolName: 'writeMemory' });
   */
  it('exposes writeMemory as the auto-apply path for durable user preferences', async () => {
    const writeResult = {
      receiptId: 'receipt-memory',
      resourceId: 'memory-1',
      status: 'applied',
      summary: 'Wrote memory.',
    } satisfies ToolWriteResult;
    const tools = createMockTools(writeResult);
    const { modelRuntime } = createMockModelRuntime([
      {
        content: 'I will remember the durable preference.',
        toolCalls: [
          {
            function: {
              arguments: JSON.stringify({
                content: 'User prefers concise implementation summaries.',
                evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
                idempotencyKey: 'source-1:write-memory',
              }),
              name: 'writeMemory',
            },
            id: 'tool-call-memory',
            type: 'function',
          },
        ],
      },
      {
        content: 'Saved the preference.',
      },
    ]);

    const result = await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 5,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    expect(tools.writeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'User prefers concise implementation summaries.',
        evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
        idempotencyKey: 'source-1:write-memory',
        userId: 'user-1',
      }),
    );
    expect(result.writeOutcomes).toEqual([{ result: writeResult, toolName: 'writeMemory' }]);
  });

  /**
   * @example
   * expect(prompt).toContain('skill_document_with_tool_failure');
   * expect(prompt).toContain('createSelfReviewProposal');
   */
  it('shows deterministic proposal rules for skill document failures in the review prompt', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'No action.',
      },
    ]);

    await executeSelfIteration({
      agentId: 'agent-1',
      context: {
        ...reviewContext,
        documentActivity: {
          ...reviewContext.documentActivity,
          skillBucket: [
            {
              agentDocumentId: 'skill-doc-1',
              documentId: 'doc-1',
              hintIsSkill: false,
              reason: 'templateId=agent-skill',
              updatedAt: '2026-05-04T13:00:00.000Z',
            },
          ],
        },
        selfReviewSignals: [
          {
            evidenceRefs: [
              { id: 'topic-1', type: 'topic' },
              { id: 'message-1', type: 'message' },
              { id: 'skill-doc-1', type: 'agent_document' },
            ],
            features: [
              {
                apiName: 'replaceSkillContentCAS',
                failedCount: 2,
                identifier: 'agent-signal-self-iteration',
                topicCount: 1,
                totalCount: 2,
                type: 'tool_usage',
              },
            ],
            kind: 'skill_document_with_tool_failure',
            strength: 'medium',
          },
        ],
        managedSkills: [
          {
            documentId: 'skill-doc-1',
            name: 'release-note-checklist',
            readonly: false,
          },
        ],
        toolActivity: [
          {
            apiName: 'replaceSkillContentCAS',
            failedCount: 2,
            identifier: 'agent-signal-self-iteration',
            messageIds: ['message-1'],
            sampleArgs: [
              JSON.stringify({
                bodyMarkdown: '# Release note checklist',
                proposalKey: 'agent-1:refine_skill:agent_document:skill-doc-1',
                skillDocumentId: 'skill-doc-1',
              }),
            ],
            sampleErrors: ['CAS snapshot failed'],
            topicIds: ['topic-1'],
            totalCount: 2,
          },
        ],
      },
      maxSteps: 1,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    const prompt = JSON.stringify(chat.mock.calls[0]?.[0].messages);

    expect(prompt).toContain('skill_document_with_tool_failure');
    expect(prompt).toContain('createSelfReviewProposal');
    expect(prompt).toContain('# Release note checklist');
    expect(prompt).toContain('refine_skill');
    expect(prompt).toContain('replaceSkillContentCAS');
  });

  /**
   * @example
   * expect(systemPrompt).toContain('getEvidenceDigest');
   * expect(systemPrompt).toContain('readSelfReviewProposal');
   */
  it('tells the model to keep evidence ids separate from self-review proposal keys', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([{ content: 'No action needed.' }]);

    await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 1,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    const systemPrompt = chat.mock.calls[0]?.[0].messages[0]?.content;

    expect(systemPrompt).toContain('getEvidenceDigest');
    expect(systemPrompt).toContain('readSelfReviewProposal');
    expect(systemPrompt).toContain('Evidence ids and proposal keys are different namespaces');
  });

  /**
   * @example
   * expect(userPrompt).toContain('<self_iteration_review');
   * expect(userPrompt).toContain('<nightly_review_context_json>');
   */
  it('wraps the nightly review prompt in XML while keeping review labels visible', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([{ content: 'No action needed.' }]);

    await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 1,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    const userPrompt = chat.mock.calls[0]?.[0].messages[1]?.content;

    expect(userPrompt).toContain('<self_iteration_review');
    expect(userPrompt).toContain('review_window_start="2026-05-03T14:00:00.000Z"');
    expect(userPrompt).toContain('review_window_end="2026-05-04T14:00:00.000Z"');
    expect(userPrompt).toContain('<nightly_review_context_json>');
    expect(userPrompt).not.toContain('Self-iteration context JSON:');
  });

  /**
   * @example
   * expect(userPrompt).toContain('Mode: reflection');
   * expect(tools.getEvidenceDigest).toHaveBeenCalledWith(expect.objectContaining({ reviewWindowStart: '2026-05-04T14:00:00.000Z' }));
   */
  it('exposes explicit mode and evidence window to the prompt and evidence tool fallback', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'I will inspect evidence.',
        toolCalls: [
          {
            function: {
              arguments: JSON.stringify({
                evidenceIds: ['task-1'],
              }),
              name: 'getEvidenceDigest',
            },
            id: 'tool-call-evidence',
            type: 'function',
          },
        ],
      },
      {
        content: 'Evidence inspected.',
      },
    ]);

    await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 2,
      mode: 'reflection',
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
      window: {
        end: '2026-05-04T14:30:00.000Z',
        start: '2026-05-04T14:00:00.000Z',
      },
    });

    const userPrompt = chat.mock.calls[0]?.[0].messages[1]?.content;

    expect(userPrompt).toContain('Mode: reflection');
    expect(userPrompt).toContain(
      'Evidence window: 2026-05-04T14:00:00.000Z to 2026-05-04T14:30:00.000Z',
    );
    expect(tools.getEvidenceDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceIds: ['task-1'],
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-04T14:00:00.000Z',
      }),
    );
  });

  /**
   * @example
   * expect(result.writeOutcomes).toEqual([]);
   * expect(chat).toHaveBeenCalledTimes(2);
   */
  it('returns an unsupported tool result to the model without throwing the run', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'I will call an unknown tool.',
        toolCalls: [
          {
            function: {
              arguments: '{"unexpected":true}',
              name: 'missingSelfIterationTool',
            },
            id: 'tool-call-unsupported',
            type: 'function',
          },
        ],
      },
      {
        content: 'Unsupported tool noted.',
      },
    ]);

    const result = await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 4,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(tools.createSkillIfAbsent).not.toHaveBeenCalled();
    expect(result.content).toContain('Unsupported tool noted.');
    expect(result.writeOutcomes).toEqual([]);
  });

  /**
   * @example
   * expect(tools.createSkillIfAbsent).toHaveBeenCalledTimes(1);
   * expect(chat).toHaveBeenCalledTimes(2);
   */
  it('allows AgentRuntime to execute a tool and final continuation when maxSteps is one', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'I will create a skill.',
        toolCalls: [
          {
            function: {
              arguments: JSON.stringify({
                bodyMarkdown: '# Skill',
                idempotencyKey: 'source-1:max-step-create',
                name: 'bounded-skill',
              }),
              name: 'createSkillIfAbsent',
            },
            id: 'tool-call-max-step',
            type: 'function',
          },
        ],
      },
      {
        content: 'Finished after the tool result.',
      },
    ]);

    const result = await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 1,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    expect(tools.createSkillIfAbsent).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[0].tools).toEqual([]);
    expect(result.content).toContain('Finished after the tool result.');
    expect(result.writeOutcomes).toHaveLength(1);
  });

  /**
   * @example
   * expect(modelVisibleMessages).toContain('Self-review tool call failed.');
   * expect(modelVisibleMessages).not.toContain('secret-token-123');
   */
  it('sanitizes thrown tool errors before adding model-visible tool messages', async () => {
    const tools = {
      ...createMockTools(),
      createSkillIfAbsent: vi.fn(async () => {
        throw new Error('upstream secret-token-123 failed');
      }),
    } satisfies ToolSet;
    const { chat, modelRuntime } = createMockModelRuntime([
      {
        content: 'I will create a skill.',
        toolCalls: [
          {
            function: {
              arguments: JSON.stringify({
                bodyMarkdown: '# Skill',
                idempotencyKey: 'source-1:sensitive-error',
                name: 'sensitive-skill',
              }),
              name: 'createSkillIfAbsent',
            },
            id: 'tool-call-sensitive-error',
            type: 'function',
          },
        ],
      },
      {
        content: 'The tool failed safely.',
      },
    ]);

    await executeSelfIteration({
      agentId: 'agent-1',
      context: reviewContext,
      maxSteps: 5,
      model: 'gpt-test',
      modelRuntime,
      sourceId: 'source-1',
      tools,
      userId: 'user-1',
    });

    const modelVisibleMessages = JSON.stringify(chat.mock.calls[1]?.[0].messages);

    expect(modelVisibleMessages).toContain('Self-iteration tool call failed.');
    expect(modelVisibleMessages).not.toContain('secret-token-123');
  });
});

describe('createAgentRunner', () => {
  /**
   * @example
   * expect(result.projectionPlan.actions).toHaveLength(1);
   */
  it('passes source metadata, max steps, and tools into the backend runner', async () => {
    const tools = createNoopTools();
    const run = vi.fn<() => Promise<AgentRunResult>>(async () => ({
      execution: {
        actions: [
          {
            idempotencyKey: 'source-1:noop',
            status: ActionStatus.Skipped,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      projectionPlan: {
        actions: [
          {
            actionType: 'noop',
            applyMode: ApplyMode.Skip,
            confidence: 1,
            dedupeKey: 'noop',
            evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
            idempotencyKey: 'source-1:noop',
            rationale: 'No change needed.',
            risk: Risk.Low,
          },
        ],
        localDate: '2026-05-04',
        plannerVersion: 'test',
        reviewScope: Scope.Nightly,
        summary: 'No change needed.',
      },
      stepCount: 2,
    }));
    const runner = createAgentRunner({ maxSteps: 10, run, tools });

    const result = await runner.run({
      context: reviewContext,
      localDate: '2026-05-04',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        context: reviewContext,
        localDate: '2026-05-04',
        maxSteps: 10,
        reviewScope: Scope.Nightly,
        sourceId: 'source-1',
        tools,
        userId: 'user-1',
      }),
    );
    expect(result.execution.sourceId).toBe('source-1');
    expect(result.projectionPlan.actions).toHaveLength(1);
  });

  /**
   * @example
   * expect(result.execution.status).toBe('failed');
   */
  it('returns a conservative failed envelope when the backend runner throws', async () => {
    const runner = createAgentRunner({
      run: vi.fn(async () => {
        throw new Error('model failed');
      }),
      tools: createNoopTools(),
    });

    const result = await runner.run({
      context: reviewContext,
      localDate: '2026-05-04',
      sourceId: 'source-1',
      userId: 'user-1',
    });

    expect(result.execution).toEqual({
      actions: [],
      sourceId: 'source-1',
      status: ReviewRunStatus.Failed,
    });
    expect(result.projectionPlan).toEqual(
      expect.objectContaining({
        actions: [],
        localDate: '2026-05-04',
        reviewScope: Scope.Nightly,
      }),
    );
    expect(result.stepCount).toBe(10);
  });
});
