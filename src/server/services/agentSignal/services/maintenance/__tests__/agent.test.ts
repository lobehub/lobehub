// @vitest-environment node
import type { ChatMethodOptions, ChatStreamPayload, ModelRuntime } from '@lobechat/model-runtime';
import type * as ModelRuntimeModule from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import type { MessageToolCall, ModelUsage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runMaintenanceToolFirstRuntime } from '../agent';
import type { NightlyReviewContext } from '../nightlyCollector';
import type { MaintenanceTools, MaintenanceToolWriteResult } from '../tools';

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
  maintenanceSignals: [],
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

const createMockTools = (writeResult?: MaintenanceToolWriteResult): MaintenanceTools => ({
  closeMaintenanceProposal: vi.fn(async () => ({
    receiptId: 'receipt-close',
    status: 'applied' as const,
  })),
  createMaintenanceProposal: vi.fn(async () => ({
    receiptId: 'receipt-proposal',
    status: 'proposed' as const,
  })),
  createSkillIfAbsent: vi.fn(async () =>
    writeResult
      ? writeResult
      : {
          receiptId: 'receipt-skill',
          resourceId: 'skill-1',
          status: 'applied' as const,
          summary: 'Created skill.',
        },
  ),
  getEvidenceDigest: vi.fn(async () => ({ evidence: [] })),
  getManagedSkill: vi.fn(async () => ({ id: 'skill-1' })),
  listMaintenanceProposals: vi.fn(async () => []),
  listManagedSkills: vi.fn(async () => []),
  readMaintenanceProposal: vi.fn(async () => undefined),
  refreshMaintenanceProposal: vi.fn(async () => ({
    receiptId: 'receipt-refresh',
    status: 'proposed' as const,
  })),
  replaceSkillContentCAS: vi.fn(async () => ({
    receiptId: 'receipt-replace',
    status: 'applied' as const,
  })),
  supersedeMaintenanceProposal: vi.fn(async () => ({
    receiptId: 'receipt-supersede',
    status: 'applied' as const,
  })),
  writeMemory: vi.fn(async () =>
    writeResult
      ? writeResult
      : {
          receiptId: 'receipt-memory',
          resourceId: 'memory-1',
          status: 'applied' as const,
          summary: 'Wrote memory.',
        },
  ),
});

describe('runMaintenanceToolFirstRuntime', () => {
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
    } satisfies MaintenanceToolWriteResult;
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

    const result = await runMaintenanceToolFirstRuntime({
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
    } satisfies MaintenanceToolWriteResult;
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

    const result = await runMaintenanceToolFirstRuntime({
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
   * expect(systemPrompt).toContain('getEvidenceDigest');
   * expect(systemPrompt).toContain('readMaintenanceProposal');
   */
  it('tells the model to keep evidence ids separate from maintenance proposal keys', async () => {
    const tools = createMockTools();
    const { chat, modelRuntime } = createMockModelRuntime([{ content: 'No action needed.' }]);

    await runMaintenanceToolFirstRuntime({
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
    expect(systemPrompt).toContain('readMaintenanceProposal');
    expect(systemPrompt).toContain('Evidence ids and proposal keys are different namespaces');
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
              name: 'missingMaintenanceTool',
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

    const result = await runMaintenanceToolFirstRuntime({
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

    const result = await runMaintenanceToolFirstRuntime({
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
   * expect(modelVisibleMessages).toContain('Maintenance tool call failed.');
   * expect(modelVisibleMessages).not.toContain('secret-token-123');
   */
  it('sanitizes thrown tool errors before adding model-visible tool messages', async () => {
    const tools = {
      ...createMockTools(),
      createSkillIfAbsent: vi.fn(async () => {
        throw new Error('upstream secret-token-123 failed');
      }),
    } satisfies MaintenanceTools;
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

    await runMaintenanceToolFirstRuntime({
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

    expect(modelVisibleMessages).toContain('Maintenance tool call failed.');
    expect(modelVisibleMessages).not.toContain('secret-token-123');
  });
});
