// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ProviderSkillsAgentDocumentUtils from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
import { createSkillTree } from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';

import type { RuntimeProcessorContext } from '../../../../runtime/context';
import {
  collectAgentSkillDecisionCandidates,
  defineSkillManagementActionHandler,
  handleSkillManagementSignal,
} from '../skillManagement';

const skillDecisionRunner = vi.fn();
const skillMaintainerRunner = vi.fn();
const skillMaintainerService = {
  readSkillFile: vi.fn(),
  removeSkillFile: vi.fn(),
  updateSkill: vi.fn(),
  writeSkillFile: vi.fn(),
};

vi.mock('@/server/services/agentDocuments/headlessEditor', () => ({
  createMarkdownEditorSnapshot: vi.fn(async (content: string) => ({
    content,
    editorData: { markdown: content },
  })),
}));

vi.mock(
  '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils',
  async (importOriginal) => {
    const actual = await importOriginal<typeof ProviderSkillsAgentDocumentUtils>();

    return {
      ...actual,
      createSkillTree: vi.fn(),
    };
  },
);

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
    skillDecisionRunner.mockReset();
    skillMaintainerRunner.mockReset();
    skillMaintainerService.readSkillFile.mockReset();
    skillMaintainerService.removeSkillFile.mockReset();
    skillMaintainerService.updateSkill.mockReset();
    skillMaintainerService.writeSkillFile.mockReset();
  });

  it('does not run when self iteration is disabled', async () => {
    const result = await handleSkillManagementSignal({
      decide: vi.fn(),
      payload: { agentId: 'agent-1', feedbackMessage: 'Make this a reusable checklist.' },
      selfIterationEnabled: false,
    });

    expect(result.status).toBe('skipped');
  });

  it('runs the decision step when self iteration is enabled', async () => {
    const decide = vi.fn().mockResolvedValue({ action: 'create', confidence: 0.9 });
    const result = await handleSkillManagementSignal({
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
    for (const action of ['create', 'refine', 'consolidate', 'noop'] as const) {
      const result = await handleSkillManagementSignal({
        decide: vi.fn().mockResolvedValue({ action, confidence: 0.9 }),
        payload: { agentId: 'agent-1', feedbackMessage: 'Make this reusable.' },
        selfIterationEnabled: true,
      });

      expect(result).toMatchObject({ decision: { action }, status: 'decided' });
    }
  });

  /**
   * @example
   * Removed lifecycle tools must not leak into the action result.
   */
  it('does not return automatic lifecycle tool actions from decision output', async () => {
    const result = await handleSkillManagementSignal({
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
   * Candidate ids are managed package names, while names remain display labels.
   */
  it('collects managed skill folders as package-name decision candidates', () => {
    expect(
      collectAgentSkillDecisionCandidates([
        {
          documentId: 'folder-doc',
          filename: 'Review Skill',
          metadata: {
            lobeSkill: {
              namespace: 'agent',
              role: 'skill-folder',
              skillName: 'review-skill',
            },
          },
          title: 'Review Skill',
        },
        {
          documentId: 'file-doc',
          filename: 'SKILL.md',
          metadata: {
            lobeSkill: {
              namespace: 'agent',
              role: 'skill-file',
              skillName: 'review-skill',
            },
          },
          title: 'SKILL.md',
        },
      ] as never),
    ).toEqual([{ id: 'review-skill', name: 'Review Skill', scope: 'agent' }]);
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

    expect(skillDecisionRunner).toHaveBeenCalledWith({
      agentId: 'agent_1',
      evidence: [{ cue: 'reusable', excerpt: 'Make this a reusable checklist.' }],
      feedbackMessage: 'Make this a reusable checklist for PR reviews.',
      topicId: 'topic_1',
      turnContext: '{"surface":"chat"}',
    });
    expect(result).toMatchObject({
      output: {
        decision: { action: 'create', confidence: 0.9, reason: 'reusable workflow feedback' },
      },
      status: 'applied',
    });
    expect(context.runtimeState.touchGuardState).toHaveBeenCalledTimes(1);
  });

  /**
   * @example
   * Decision agents receive managed skill package candidates so targetSkillIds can be stable ids.
   */
  it('passes discovered candidate skills into the decision step', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      confidence: 0.8,
      reason: 'update existing skill',
      targetSkillIds: ['review-skill'],
    });
    skillMaintainerService.readSkillFile.mockResolvedValue('# Review Skill');
    skillMaintainerRunner.mockResolvedValue({ operations: [], reason: 'no file changes' });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillCandidateSkillsFactory: async () => [
        { id: 'review-skill', name: 'Review Skill', scope: 'agent' },
      ],
      skillDecisionRunner,
      skillMaintainerRunner,
      skillMaintainerServiceFactory: () => skillMaintainerService,
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
        candidateSkills: [{ id: 'review-skill', name: 'Review Skill', scope: 'agent' }],
      }),
    );
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
    expect(createSkillTree).not.toHaveBeenCalled();
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
    expect(createSkillTree).not.toHaveBeenCalled();
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
   * A refine decision invokes the maintainer agent and applies returned file operations.
   */
  it('runs the maintainer workflow for refine decisions', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      reason: 'update existing review skill',
      targetSkillIds: ['review-skill'],
    });
    skillMaintainerService.readSkillFile.mockResolvedValue('# Review Skill');
    skillMaintainerRunner.mockResolvedValue({
      operations: [
        {
          arguments: {
            content: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
            path: 'SKILL.md',
            skillRef: 'review-skill',
          },
          name: 'updateSkill',
        },
      ],
      reason: 'refined review skill',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillMaintainerServiceFactory: () => skillMaintainerService,
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
        targetSkills: [{ content: '# Review Skill', id: 'review-skill', metadata: {} }],
        type: 'refine',
      }),
    );
    expect(skillMaintainerService.updateSkill).toHaveBeenCalledWith({
      content: '# Review Skill\n\n## Procedure\n- Check failed assertions first.',
      path: 'SKILL.md',
      skillRef: 'review-skill',
    });
    expect(result).toMatchObject({
      detail: 'refined review skill',
      output: { decision: { action: 'refine' } },
      status: 'applied',
    });
  });

  /**
   * @example
   * A maintainer operation naming a non-target skill is rejected before mutation.
   */
  it('rejects maintainer operations that target skills outside the decision target set', async () => {
    skillDecisionRunner.mockResolvedValue({
      action: 'refine',
      reason: 'update existing review skill',
      targetSkillIds: ['review-skill'],
    });
    skillMaintainerService.readSkillFile.mockResolvedValue('# Review Skill');
    skillMaintainerRunner.mockResolvedValue({
      operations: [
        {
          arguments: {
            content: '# Other Skill',
            path: 'SKILL.md',
            skillRef: 'other-skill',
          },
          name: 'updateSkill',
        },
      ],
      reason: 'attempted cross-target write',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillMaintainerServiceFactory: () => skillMaintainerService,
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

    expect(skillMaintainerService.updateSkill).not.toHaveBeenCalled();
    expect(skillMaintainerService.writeSkillFile).not.toHaveBeenCalled();
    expect(skillMaintainerService.removeSkillFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining('other-skill'),
      },
      status: 'failed',
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
      targetSkillIds: ['review-skill', 'review-checklist'],
    });
    skillMaintainerService.readSkillFile
      .mockResolvedValueOnce('# Review Skill')
      .mockResolvedValueOnce('# Review Checklist');
    skillMaintainerRunner.mockResolvedValue({
      operations: [
        {
          arguments: {
            content: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
            path: 'SKILL.md',
            skillRef: 'review-skill',
          },
          name: 'updateSkill',
        },
      ],
      proposedLifecycleActions: [
        {
          action: 'archive',
          reason: 'merged into review-skill',
          skillRef: 'review-checklist',
        },
      ],
      reason: 'consolidated review skills',
    });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
      skillDecisionRunner,
      skillMaintainerRunner,
      skillMaintainerServiceFactory: () => skillMaintainerService,
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
          { content: '# Review Skill', id: 'review-skill', metadata: {} },
          { content: '# Review Checklist', id: 'review-checklist', metadata: {} },
        ],
        type: 'consolidate',
      }),
    );
    expect(skillMaintainerService.updateSkill).toHaveBeenCalledWith({
      content: '# Review Skill\n\n## Procedure\n- Use one consolidated checklist.',
      path: 'SKILL.md',
      skillRef: 'review-skill',
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
    vi.mocked(createSkillTree).mockRejectedValueOnce(new Error('Skill already exists'));
    skillDecisionRunner.mockResolvedValue({ action: 'create', reason: 'reusable workflow' });

    const handler = defineSkillManagementActionHandler({
      db: {} as never,
      selfIterationEnabled: true,
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
