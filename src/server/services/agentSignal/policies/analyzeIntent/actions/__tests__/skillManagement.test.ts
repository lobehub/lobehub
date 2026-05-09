// @vitest-environment node
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SkillManagementDocumentService } from '@/server/services/skillManagement';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import {
  collectAgentSkillDecisionCandidates,
  defineSkillManagementActionHandler,
  executeSkillManagementDecision,
  isAgentDocumentRelatedObject,
  readAgentSignalHintIsSkill,
  runSkillDecisionAgentRuntime,
} from '../skillManagement';

const skillDecisionRunner = vi.fn();
const skillCreateRunner = vi.fn();
const skillMaintainerRunner = vi.fn();
const skillMaintainerService = {
  createSkill: vi.fn(),
  getSkill: vi.fn(),
  listSkills: vi.fn(),
  renameSkill: vi.fn(),
  replaceSkillIndex: vi.fn(),
};
const createSkill = vi.fn();

vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: vi.fn(async (content: string) => ({
    content,
    editorData: { markdown: content },
  })),
}));

vi.mock('@/server/services/skillManagement', async (importOriginal) => {
  const actual = await importOriginal<SkillManagementDocumentService>();

  return {
    ...actual,
    SkillManagementDocumentService: vi.fn(() => ({
      createSkill,
      getSkill: skillMaintainerService.getSkill,
      listSkills: skillMaintainerService.listSkills,
      renameSkill: skillMaintainerService.renameSkill,
      replaceSkillIndex: skillMaintainerService.replaceSkillIndex,
    })),
  };
});

const context = {
  now: () => 1,
  runtimeState: {
    getGuardState: vi.fn().mockResolvedValue({}),
    touchGuardState: vi.fn().mockResolvedValue({}),
  },
  scopeKey: 'topic:topic-1',
} as const satisfies RuntimeProcessorContext;

describe('defineSkillManagementActionHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    skillCreateRunner.mockReset();
    skillDecisionRunner.mockReset();
    skillMaintainerRunner.mockReset();
    skillMaintainerService.createSkill.mockReset();
    skillMaintainerService.getSkill.mockReset();
    skillMaintainerService.listSkills.mockReset();
    skillMaintainerService.renameSkill.mockReset();
    skillMaintainerService.replaceSkillIndex.mockReset();
    createSkill.mockReset();
    skillCreateRunner.mockResolvedValue({
      bodyMarkdown: '# PR Review Checklist',
      confidence: 0.9,
      description: 'Use when creating reusable PR review checklists.',
      name: 'pr-review-checklist',
      reason: 'authored reusable workflow',
      title: 'PR Review Checklist',
    });
    createSkill.mockResolvedValue({
      bundle: {
        agentDocumentId: 'pr-review-checklist-bundle-id',
        documentId: 'pr-review-checklist-bundle-doc',
        filename: 'pr-review-checklist',
        title: 'PR Review Checklist',
      },
      content: '# PR Review Checklist',
      description: 'Use when creating reusable PR review checklists.',
      frontmatter: {
        description: 'Use when creating reusable PR review checklists.',
        name: 'pr-review-checklist',
      },
      index: {
        agentDocumentId: 'pr-review-checklist-index-id',
        documentId: 'pr-review-checklist-index-doc',
        filename: 'SKILL.md',
        title: 'SKILL.md',
      },
      name: 'pr-review-checklist',
      title: 'PR Review Checklist',
    });
    skillMaintainerService.getSkill.mockImplementation(async ({ agentDocumentId }) => ({
      bundle: {
        agentDocumentId,
        documentId: `${agentDocumentId}-doc`,
        filename: agentDocumentId,
        title: agentDocumentId,
      },
      content: `# ${agentDocumentId}`,
      description: `${agentDocumentId} description`,
      frontmatter: { description: `${agentDocumentId} description`, name: agentDocumentId },
      index: {
        agentDocumentId: `${agentDocumentId}-index`,
        documentId: `${agentDocumentId}-index-doc`,
        filename: 'SKILL.md',
        title: 'SKILL.md',
      },
      name: agentDocumentId,
      title: agentDocumentId,
    }));
    skillMaintainerService.replaceSkillIndex.mockResolvedValue(undefined);
    skillMaintainerService.renameSkill.mockResolvedValue(undefined);
  });

  it('does not run when self iteration is disabled', async () => {
    const result = await executeSkillManagementDecision({
      decide: vi.fn(),
      payload: { agentId: 'agent-1', feedbackMessage: 'Make this a reusable checklist.' },
      selfIterationEnabled: false,
    });

    expect(result.status).toBe('skipped');
  });

  it('runs the decision step when self iteration is enabled', async () => {
    const decide = vi.fn().mockResolvedValue({ action: 'create', confidence: 0.9 });
    const result = await executeSkillManagementDecision({
      decide,
      payload: { agentId: 'agent-1', feedbackMessage: 'Make this a reusable checklist.' },
      selfIterationEnabled: true,
    });

    expect(decide).toHaveBeenCalled();
    expect(result.status).toBe('decided');
  });

  /**
   * @example
   * Skill decisions preserve the four v1.2 action values.
   */
  it('returns structured results for each v1.2 decision action', async () => {
    for (const action of ['create', 'refine', 'consolidate', 'noop', 'reject'] as const) {
      const result = await executeSkillManagementDecision({
        decide: vi.fn().mockResolvedValue({ action, confidence: 0.9 }),
        payload: { agentId: 'agent-1', feedbackMessage: 'Make this reusable.' },
        selfIterationEnabled: true,
      });

      expect(result).toMatchObject({ decision: { action }, status: 'decided' });
    }
  });

  /**
   * @example
   * The decision agent can inspect same-turn document outcomes before returning reject.
   */
  it('runs read-only decision tools through AgentRuntime before submitting a decision', async () => {
    const response = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      );
    const chat = vi
      .fn()
      .mockImplementationOnce(async (_payload, options) => {
        await options.callback.onToolsCalling({
          toolsCalling: [
            {
              function: {
                arguments: '{"messageId":"msg_1","scopeKey":"topic:topic_1"}',
                name: 'agent-signal-skill-decision____listSameTurnDocumentOutcomes',
              },
              id: 'call_list_outcomes',
              type: 'function',
            },
          ],
        });
        return response();
      })
      .mockImplementationOnce(async (_payload, options) => {
        await options.callback.onToolsCalling({
          toolsCalling: [
            {
              function: {
                arguments: '{"agentDocumentId":"agent_doc_1"}',
                name: 'agent-signal-skill-decision____readDocument',
              },
              id: 'call_read_document',
              type: 'function',
            },
          ],
        });
        return response();
      })
      .mockImplementationOnce(async (_payload, options) => {
        await options.callback.onToolsCalling({
          toolsCalling: [
            {
              function: {
                arguments:
                  '{"action":"reject","confidence":0.9,"documentRefs":["doc_1"],"reason":"The same turn created a document and forbids skill conversion.","requiredReads":[],"targetSkillRefs":[]}',
                name: 'agent-signal-skill-decision____submitDecision',
              },
              id: 'call_submit_decision',
              type: 'function',
            },
          ],
        });
        return response();
      });
    const tools = {
      listCandidateDocuments: vi.fn(),
      listSameTurnDocumentOutcomes: vi.fn().mockResolvedValue([
        {
          agentDocumentId: 'agent_doc_1',
          hintIsSkill: true,
          relation: 'created',
          summary: 'Agent documents created a document.',
        },
      ]),
      readDocument: vi.fn().mockResolvedValue({
        agentDocumentId: 'agent_doc_1',
        content: '# Draft',
        documentId: 'documents_row_1',
        title: 'Draft',
      }),
    };

    const result = await runSkillDecisionAgentRuntime({
      model: 'test-model',
      modelRuntime: { chat },
      payload: {
        agentId: 'agent_1',
        feedbackMessage: 'Create a document for this, do not make it a skill.',
        messageId: 'msg_1',
        topicId: 'topic_1',
      },
      tools,
    });

    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ metadata: { trigger: RequestTrigger.AgentSignal } }),
    );
    expect(tools.listSameTurnDocumentOutcomes).toHaveBeenCalledWith({
      agentId: 'agent_1',
      messageId: 'msg_1',
      scopeKey: 'topic:topic_1',
      topicId: 'topic_1',
    });
    expect(tools.readDocument).toHaveBeenCalledWith({ agentDocumentId: 'agent_doc_1' });
    expect(chat.mock.calls[1]?.[0].messages).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('"hintIsSkill":true'),
        role: 'tool',
      }),
    );
    expect(result).toMatchObject({
      action: 'reject',
      documentRefs: ['doc_1'],
      reason: 'The same turn created a document and forbids skill conversion.',
    });
  });

  /**
   * @example
   * Only explicit boolean metadata becomes same-turn hint evidence.
   */
  it('parses hintIsSkill only from explicit boolean agent-signal metadata', () => {
    expect(readAgentSignalHintIsSkill({ agentSignal: { hintIsSkill: true } })).toBe(true);
    expect(readAgentSignalHintIsSkill({ agentSignal: { hintIsSkill: false } })).toBe(false);
    expect(readAgentSignalHintIsSkill({ agentSignal: { hintIsSkill: 'true' } })).toBeUndefined();
    expect(readAgentSignalHintIsSkill({ agentSignal: null })).toBeUndefined();
    expect(readAgentSignalHintIsSkill(undefined)).toBeUndefined();
  });

  /**
   * @example
   * Negative or missing same-turn hints remain evidence only; they do not force mutation actions.
   */
  it('does not force refine or consolidate from hintIsSkill false or missing document snapshots', async () => {
    const response = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      );
    const chat = vi
      .fn()
      .mockImplementationOnce(async (_payload, options) => {
        await options.callback.onToolsCalling({
          toolsCalling: [
            {
              function: {
                arguments: '{"messageId":"msg_1","scopeKey":"topic:topic_1"}',
                name: 'agent-signal-skill-decision____listSameTurnDocumentOutcomes',
              },
              id: 'call_list_outcomes',
              type: 'function',
            },
          ],
        });
        return response();
      })
      .mockImplementationOnce(async (_payload, options) => {
        await options.callback.onToolsCalling({
          toolsCalling: [
            {
              function: {
                arguments:
                  '{"action":"noop","confidence":0.7,"documentRefs":[],"reason":"Negative or missing hints are not enough to mutate a skill.","requiredReads":[],"targetSkillRefs":[]}',
                name: 'agent-signal-skill-decision____submitDecision',
              },
              id: 'call_submit_decision',
              type: 'function',
            },
          ],
        });
        return response();
      });
    const tools = {
      listCandidateDocuments: vi.fn(),
      listSameTurnDocumentOutcomes: vi.fn().mockResolvedValue([
        {
          agentDocumentId: 'agent_doc_false',
          hintIsSkill: false,
          relation: 'created',
          summary: 'Document outcome explicitly says this is not a skill.',
        },
        {
          agentDocumentId: 'agent_doc_missing_snapshot',
          relation: 'created',
          summary: 'Document snapshot is missing metadata.',
        },
      ]),
      readDocument: vi.fn(),
    };

    const result = await runSkillDecisionAgentRuntime({
      model: 'test-model',
      modelRuntime: { chat },
      payload: {
        agentId: 'agent_1',
        feedbackMessage: 'Keep the result around if useful.',
        messageId: 'msg_1',
        topicId: 'topic_1',
      },
      tools,
    });

    expect(chat.mock.calls[1]?.[0].messages).toContainEqual(
      expect.objectContaining({
        content: expect.stringContaining('"hintIsSkill":false'),
        role: 'tool',
      }),
    );
    expect(tools.readDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: 'noop',
      reason: 'Negative or missing hints are not enough to mutate a skill.',
    });
    expect(result.action).not.toBe('refine');
    expect(result.action).not.toBe('consolidate');
  });

  /**
   * @example
   * Same-turn document receipts emitted by lobe-agent-documents use the agent document binding id.
   */
  it('accepts agent-document related objects for same-turn document evidence', () => {
    expect(isAgentDocumentRelatedObject({ objectType: 'agent-document' })).toBe(true);
    expect(isAgentDocumentRelatedObject({ objectType: 'document' })).toBe(false);
    expect(isAgentDocumentRelatedObject({ objectType: 'file' })).toBe(false);
  });

  /**
   * @example
   * Removed lifecycle tools must not leak into the action result.
   */
  it('does not return automatic lifecycle tool actions from decision output', async () => {
    const result = await executeSkillManagementDecision({
      decide: vi.fn().mockResolvedValue({
        action: 'consolidate',
        archiveSkill: { skillRef: 'skill-1' },
        deleteSkill: { skillRef: 'skill-1' },
        proposedLifecycleActions: [
          { action: 'archive', reason: 'superseded', skillRef: 'skill-1' },
        ],
      }),
      payload: { agentId: 'agent-1', feedbackMessage: 'These two skills overlap.' },
      selfIterationEnabled: true,
    });

    expect(JSON.stringify(result)).not.toContain('deleteSkill');
    expect(JSON.stringify(result)).not.toContain('archiveSkill');
  });

  /**
   * @example
   * Candidate ids are managed bundle agent document ids, while names remain display labels.
   */
  it('collects managed skill bundles as agent-document decision candidates', () => {
    expect(
      collectAgentSkillDecisionCandidates([
        {
          documentId: 'bundle-doc',
          fileType: 'skills/bundle',
          filename: 'review-skill',
          id: 'bundle-binding',
          parentId: null,
          templateId: 'agent-skill',
          title: 'Review Skill',
        },
        {
          documentId: 'file-doc',
          fileType: 'skills/index',
          filename: 'SKILL.md',
          id: 'file-binding',
          parentId: 'bundle-doc',
          templateId: 'agent-skill',
          title: 'SKILL.md',
        },
      ] as never),
    ).toEqual([{ id: 'bundle-binding', name: 'Review Skill', scope: 'agent' }]);
  });

  /**
   * @example
   * Skill-domain feedback records a structured create decision and creates a document-backed agent skill.
   */
  it('runs the skill action after the injected decision step', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'create',
      confidence: 0.9,
      reason: 'reusable workflow feedback',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillCreateRunner,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_agent',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          evidence: [{ cue: 'reusable', excerpt: 'Make this a reusable checklist.' }],
          feedbackHint: 'not_satisfied',
          idempotencyKey: 'source_1:skill:msg_1',
          message: 'Make this a reusable checklist for PR reviews.',
          reason: 'reusable workflow feedback',
          serializedContext: '{"surface":"chat"}',
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillDecisionRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent_1',
        evidence: [{ cue: 'reusable', excerpt: 'Make this a reusable checklist.' }],
        feedbackMessage: 'Make this a reusable checklist for PR reviews.',
        topicId: 'topic_1',
        turnContext: '{"surface":"chat"}',
      }),
    );
    expect(result).toMatchObject({
      output: {
        decision: { action: 'create', confidence: 0.9, reason: 'reusable workflow feedback' },
        target: {
          id: 'pr-review-checklist-bundle-doc',
          summary: 'Use when creating reusable PR review checklists.',
          title: 'PR Review Checklist',
          type: 'skill',
        },
      },
      status: 'applied',
    });
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  /**
   * @example
   * Decision agents receive managed skill intent records so targetSkillRefs can be stable ids.
   */
  it('passes discovered candidate skills into the decision step', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      confidence: 0.8,
      reason: 'update existing skill',
      targetSkillRefs: ['review-skill-bundle-id'],
    });
    skillMaintainerRunner.mockResolvedValue({
      bodyMarkdown: '# Review Skill',
      reason: 'no file changes',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillCandidateSkillsFactory: async () => [
        { id: 'review-skill-bundle-id', name: 'Review Skill', scope: 'agent' },
      ],
      skillDecisionRunner,
      skillMaintainerRunner,
      skillManagementServiceFactory: () => skillMaintainerService,
      userId: 'user_1',
    });

    await handler.handle(
      {
        actionId: 'act_skill_candidate',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:candidate',
          message: 'Refine the review skill.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillDecisionRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateSkills: [{ id: 'review-skill-bundle-id', name: 'Review Skill', scope: 'agent' }],
      }),
    );
  });

  /**
   * @example
   * Completion-stage skill decisions receive user-stage recorded skill-intent evidence.
   */
  it('passes recorded skill intent evidence to the decision runtime on completion-triggered feedback', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'create',
      confidence: 0.88,
      documentRefs: [],
      reason: 'Completion confirmed hinted workflow document.',
      requiredReads: [],
      targetSkillRefs: [],
    });
    skillCreateRunner.mockResolvedValue({
      bodyMarkdown: '# YouTube Comment Fetch Workflow',
      name: 'youtube-comment-fetch-workflow',
      reason: 'created reusable workflow',
      title: 'YouTube Comment Fetch Workflow',
    });
    const readCandidate = vi.fn(async (input: { scopeKey: string; sourceId: string }) => {
      if (input.sourceId !== 'msg_1') return undefined;

      return {
        actionIntent: 'create' as const,
        confidence: 0.86,
        createdAt: 1000,
        explicitness: 'implicit_strong_learning' as const,
        feedbackMessageId: 'msg_1',
        reason: 'User asked to preserve this workflow.',
        route: 'direct_decision' as const,
        scopeKey: 'topic:topic-1',
        sourceId: 'msg_1',
      };
    });
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      procedureState: {
        skillIntentRecords: { read: readCandidate, write: vi.fn() },
      },
      selfIterationEnabled: true,
      skillCreateRunner,
      skillDecisionRunner,
      userId: 'user_1',
    });

    await handler.handle(
      {
        actionId: 'act_skill_candidate',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          evidence: [{ cue: 'completion', excerpt: 'assistant completed' }],
          feedbackHint: 'satisfied',
          idempotencyKey: 'source_1:skill:msg_1',
          message: 'Nice work. Can we keep this workflow?',
          messageId: 'msg_1',
          reason: 'completion-triggered skill feedback',
          serializedContext: '{"surface":"chat"}',
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: {
          payload: {
            message: 'Nice work. Can we keep this workflow?',
            messageId: 'msg_1',
            trigger: 'client.runtime.complete',
          },
          sourceId: 'assistant_1:completion:msg_1',
          sourceType: 'agent.user.message',
        } as never,
        timestamp: 1,
      },
      context,
    );

    expect(readCandidate).toHaveBeenCalledWith({
      scopeKey: 'topic:topic-1',
      sourceId: 'msg_1',
    });
    expect(skillDecisionRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          expect.objectContaining({
            cue: 'completion',
          }),
          expect.objectContaining({
            cue: 'recorded_skill_intent',
            excerpt: expect.stringContaining('User asked to preserve this workflow.'),
          }),
        ]),
      }),
    );
  });

  /**
   * @example
   * Same-turn hinted document outcomes are resolved before the decision runner is called.
   */
  it('eagerly injects hinted same-turn document evidence into the decision step', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'create',
      confidence: 0.88,
      reason: 'Hinted workflow document should be analyzed as skill evidence.',
    });
    const listSameTurnDocumentOutcomes = vi.fn(async () => [
      {
        agentDocumentId: 'agent-doc-1',
        hintIsSkill: true,
        relation: 'created',
        summary: 'Agent documents created a document.',
      },
      {
        agentDocumentId: 'agent-doc-2',
        hintIsSkill: true,
        relation: 'created',
        summary: 'Agent documents created a documented workflow.',
      },
    ]);
    const readDocument = vi.fn(async ({ agentDocumentId }: { agentDocumentId: string }) =>
      agentDocumentId === 'agent-doc-2'
        ? {
            agentDocumentId: 'agent-doc-2',
            content: `# Should Not Be Injected\n\n${'This full content must not appear. '.repeat(20)}`,
            description: 'Reusable workflow description from the document metadata.',
            documentId: 'doc-2',
            title: 'Documented Workflow',
          }
        : {
            agentDocumentId: 'agent-doc-1',
            content: `# YouTube Workflow\n\nFetch comments, summarize them, and keep the process reusable. ${'Detailed implementation step. '.repeat(
              12,
            )}TAIL_SHOULD_BE_TRUNCATED`,
            documentId: 'doc-1',
            title: 'YouTube Workflow',
          },
    );
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillCreateRunner,
      skillDecisionRunner,
      skillDecisionToolsetFactory: () => ({
        listCandidateDocuments: vi.fn(),
        listSameTurnDocumentOutcomes,
        readDocument,
      }),
      userId: 'user_1',
    });

    await handler.handle(
      {
        actionId: 'act_skill_hinted_document',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:msg_1',
          message: 'Nice work. Can we keep this workflow?',
          messageId: 'msg_1',
          serializedContext: '{"surface":"chat"}',
          topicId: 'topic_1',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(listSameTurnDocumentOutcomes).toHaveBeenCalledWith({
      agentId: 'agent_1',
      messageId: 'msg_1',
      scopeKey: 'topic:topic-1',
      topicId: 'topic_1',
    });
    expect(readDocument).toHaveBeenCalledWith({ agentDocumentId: 'agent-doc-1' });
    expect(readDocument).toHaveBeenCalledWith({ agentDocumentId: 'agent-doc-2' });
    expect(skillDecisionRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.arrayContaining([
          expect.objectContaining({
            cue: 'same_turn_hinted_document',
            excerpt: expect.stringContaining('hintIsSkill=true'),
          }),
          expect.objectContaining({
            cue: 'same_turn_hinted_document_content',
            excerpt: expect.stringContaining('Fetch comments'),
          }),
          expect.objectContaining({
            cue: 'same_turn_hinted_document_description',
            excerpt: expect.stringContaining('Reusable workflow description'),
          }),
        ]),
      }),
    );
    const decisionInput = skillDecisionRunner.mock.calls[0]?.[0];
    expect(JSON.stringify(decisionInput?.evidence)).not.toContain('TAIL_SHOULD_BE_TRUNCATED');
    expect(JSON.stringify(decisionInput?.evidence)).not.toContain('Should Not Be Injected');
  });

  /**
   * @example
   * Replayed action keys are skipped without running the document writer.
   */
  it('skips repeated actions after the same idempotency key was already applied', async () => {
    const getGuardState = vi.fn().mockResolvedValue({ lastEventAt: 1 });
    const touchGuardState = vi.fn().mockResolvedValue({});
    const idempotentContext = {
      ...context,
      runtimeState: {
        getGuardState,
        touchGuardState,
      },
    } as const satisfies RuntimeProcessorContext;

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_duplicate',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:msg_1',
          message: 'Make this a reusable checklist.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      idempotentContext,
    );

    expect(skillDecisionRunner).not.toHaveBeenCalled();
    expect(touchGuardState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'Skill-management action already applied.',
      output: { decision: { action: 'noop' } },
      status: 'skipped',
    });
  });

  /**
   * @example
   * Generic praise is normalized to noop and does not create a skill document.
   */
  it('skips generic praise through a noop decision', async () => {
    skillDecisionRunner.mockResolvedValue({ action: 'noop', reason: 'generic praise' });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_noop',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:msg_noop',
          message: 'Looks good, thanks.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      output: { decision: { action: 'noop' } },
      status: 'skipped',
    });
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
  });

  /**
   * @example
   * Malformed structured decision output is skipped instead of failing the whole action.
   */
  it('skips skill-management when the decision runner returns undefined output', async () => {
    // ROOT CAUSE:
    //
    // If modelRuntime.generateObject cannot parse provider text as JSON, it returns undefined.
    // The skill-management handler parsed that undefined value as the final decision object,
    // which turned a recoverable decision-output problem into signal.action.failed.
    //
    // We fixed this by treating non-object decision output as a noop decision.
    skillDecisionRunner.mockResolvedValue(undefined);

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_undefined_decision',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:undefined_decision',
          message: 'Create a reusable checklist for review failures.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(createSkill).not.toHaveBeenCalled();
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'decision output was not an object',
      output: { decision: { action: 'noop', reason: 'decision output was not an object' } },
      status: 'skipped',
    });
  });

  /**
   * @example
   * Provider parse failures surface as skipped decisions instead of failed signal actions.
   */
  it('skips skill-management when the decision runner rejects malformed structured output', async () => {
    // ROOT CAUSE:
    //
    // The default skill decision runner parses generateObject output before returning it to the
    // action handler. When generateObject returned undefined after a provider JSON parse failure,
    // that internal parse threw a ZodError and the outer handler emitted signal.action.failed.
    //
    // We fixed this by downgrading malformed decision-output ZodError values to a noop decision.
    const malformedStructuredOutputError = (() => {
      try {
        z.object({}).parse(undefined);
      } catch (error) {
        return error;
      }
    })();
    skillDecisionRunner.mockRejectedValue(malformedStructuredOutputError);

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_malformed_decision',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:malformed_decision',
          message: 'Create a reusable checklist for review failures.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(createSkill).not.toHaveBeenCalled();
    expect(context.runtimeState.touchGuardState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'decision structured output was malformed',
      output: {
        decision: { action: 'noop', reason: 'decision structured output was malformed' },
      },
      status: 'skipped',
    });
  });

  /**
   * @example
   * Disabled self-iteration stops before the decision agent and document writer.
   */
  it('skips skill-management before decision when self-iteration is disabled', async () => {
    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: false,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_gate_disabled',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:gate_disabled',
          message: 'Create a reusable checklist for review failures.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillDecisionRunner).not.toHaveBeenCalled();
    expect(createSkill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: 'self iteration is disabled',
      output: { decision: { action: 'noop' } },
      status: 'skipped',
    });
  });

  /**
   * @example
   * Missing action context is reported as skipped with a noop decision.
   */
  it('skips missing agentId or message before document creation', async () => {
    skillDecisionRunner.mockResolvedValue({ action: 'create', reason: 'create missing context' });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const missingAgent = await handler.handle(
      {
        actionId: 'act_skill_missing_agent',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          idempotencyKey: 'source_1:skill:missing_agent',
          message: 'Create a reusable checklist.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(missingAgent).toMatchObject({
      detail: 'Missing agentId for skill-management action.',
      output: { decision: { action: 'noop' } },
      status: 'skipped',
    });
    expect(skillDecisionRunner).not.toHaveBeenCalled();
    expect(createSkill).not.toHaveBeenCalled();
    expect(skillMaintainerRunner).not.toHaveBeenCalled();

    vi.clearAllMocks();
    skillDecisionRunner.mockResolvedValue({ action: 'create', reason: 'create missing context' });

    const missingMessage = await handler.handle(
      {
        actionId: 'act_skill_missing_message',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:missing_message',
          message: '',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(missingMessage).toMatchObject({
      detail: 'Missing skill-management action message.',
      output: { decision: { action: 'noop' } },
      status: 'skipped',
    });
  });

  /**
   * @example
   * A refine decision invokes the maintainer agent and applies returned body content.
   */
  it('runs the maintainer workflow for refine decisions', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      reason: 'update existing review skill',
      targetSkillRefs: ['review-skill-bundle-id'],
    });
    skillMaintainerRunner.mockResolvedValue({
      bodyMarkdown: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
      reason: 'refined review skill',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillManagementServiceFactory: () => skillMaintainerService,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_refine',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:refine',
          message: 'Refine the review skill with the failed assertion workflow.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillMaintainerRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSkills: [
          expect.objectContaining({
            content: '# review-skill-bundle-id',
            id: 'review-skill-bundle-id',
            name: 'review-skill-bundle-id',
          }),
        ],
        type: 'refine',
      }),
    );
    expect(skillMaintainerService.replaceSkillIndex).toHaveBeenCalledWith({
      agentDocumentId: 'review-skill-bundle-id',
      agentId: 'agent_1',
      bodyMarkdown: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
      description: undefined,
      updateReason: 'refined review skill',
    });
    expect(result).toMatchObject({
      detail: 'refined review skill',
      output: { decision: { action: 'refine' } },
      status: 'applied',
    });
  });

  /**
   * @example
   * A refine decision is skipped when the target skill cannot be resolved.
   */
  it('skips maintainer workflow when target refs cannot be resolved', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      reason: 'update existing review skill',
      targetSkillRefs: ['missing-bundle-id'],
    });
    skillMaintainerService.getSkill.mockResolvedValueOnce(undefined);

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillManagementServiceFactory: () => skillMaintainerService,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_refine_invalid_target',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:refine-invalid-target',
          message: 'Refine the review skill.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillMaintainerRunner).not.toHaveBeenCalled();
    expect(skillMaintainerService.replaceSkillIndex).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      detail: expect.stringContaining('could not resolve targetSkillRefs'),
      output: { decision: { action: 'refine' } },
      status: 'skipped',
    });
  });

  /**
   * @example
   * A consolidate decision invokes the maintainer agent with multiple target skills.
   */
  it('runs the maintainer workflow for consolidate decisions', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'consolidate',
      reason: 'overlapping review skills',
      targetSkillRefs: ['review-skill-bundle-id', 'review-checklist-bundle-id'],
    });
    skillMaintainerRunner.mockResolvedValue({
      bodyMarkdown: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
      reason: 'consolidated review skills',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillManagementServiceFactory: () => skillMaintainerService,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_consolidate',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:consolidate',
          message: 'Consolidate the overlapping review skills.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(skillMaintainerRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSkills: [
          expect.objectContaining({ id: 'review-skill-bundle-id' }),
          expect.objectContaining({ id: 'review-checklist-bundle-id' }),
        ],
        type: 'consolidate',
      }),
    );
    expect(skillMaintainerService.replaceSkillIndex).toHaveBeenCalledWith({
      agentDocumentId: 'review-skill-bundle-id',
      agentId: 'agent_1',
      bodyMarkdown: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
      description: undefined,
      updateReason: 'consolidated review skills',
    });
    expect(result).toMatchObject({
      detail: 'consolidated review skills',
      output: { decision: { action: 'consolidate' } },
      status: 'applied',
    });
  });

  /**
   * @example
   * Duplicate skill creation is reported as skipped while preserving the create decision.
   */
  it('skips duplicate skill creation with a structured create decision', async () => {
    createSkill.mockRejectedValueOnce(new Error('Skill already exists'));
    skillDecisionRunner.mockResolvedValue({ action: 'create', reason: 'reusable workflow' });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillCreateRunner,
      skillDecisionRunner,
      userId: 'user_1',
    });

    const result = await handler.handle(
      {
        actionId: 'act_skill_duplicate_create',
        actionType: 'action.skill-management.handle',
        chain: { chainId: 'chain_1', rootSourceId: 'source_1' },
        payload: {
          agentId: 'agent_1',
          idempotencyKey: 'source_1:skill:duplicate_create',
          message: 'Create a reusable checklist.',
        },
        signal: {
          signalId: 'sig_1',
          signalType: 'signal.feedback.domain.skill',
        },
        source: { sourceId: 'source_1', sourceType: 'agent.user.message' },
        timestamp: 1,
      },
      context,
    );

    expect(result).toMatchObject({
      detail: 'Skill already exists',
      output: { decision: { action: 'create' } },
      status: 'skipped',
    });
  });
});
