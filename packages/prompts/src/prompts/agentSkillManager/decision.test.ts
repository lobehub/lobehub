import { describe, expect, it } from 'vitest';

import { AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE } from './consolidate';
import {
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  createAgentSkillManagerDecisionPrompt,
} from './decision';
import { AGENT_SKILL_REFINE_SYSTEM_ROLE as REFINE_SYSTEM_ROLE } from './refine';

describe('agentSkillManager decision prompt', () => {
  it('requires strict JSON and exposes the four actions', () => {
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('create');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('refine');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('consolidate');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('noop');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('Do not wrap the JSON');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('candidateSkills[].id');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('managed skill package names');
  });

  it('serializes feedback context into the user prompt', () => {
    const prompt = createAgentSkillManagerDecisionPrompt({
      agentId: 'agent-1',
      candidateSkills: [{ id: 'skill-1', name: 'Review Checklist', scope: 'agent' }],
      evidence: [{ cue: 'reusable', excerpt: 'This should become a reusable checklist.' }],
      feedbackMessage: 'This should become a reusable checklist.',
      topicId: 'topic-1',
      turnContext: 'The assistant produced a five-step code review workflow.',
    });

    expect(prompt).toContain('"agentId":"agent-1"');
    expect(prompt).toContain('"topicId":"topic-1"');
    expect(prompt).toContain('Review Checklist');
  });

  /**
   * @example
   * Decision prompts may choose `create`, but must not expose lifecycle tools.
   */
  it('limits decisions to the v1.2 action set', () => {
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('"create"');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('"refine"');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('"consolidate"');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('"noop"');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('deleteSkill');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('mergeSkill');
  });

  /**
   * @example
   * Refinement applies focused file operations instead of patch/rewrite modes.
   */
  it('limits refine output to focused v1.2 file operations', () => {
    expect(REFINE_SYSTEM_ROLE).toContain('updateSkill');
    expect(REFINE_SYSTEM_ROLE).toContain('writeSkillFile');
    expect(REFINE_SYSTEM_ROLE).toContain('removeSkillFile');
    expect(REFINE_SYSTEM_ROLE).toContain('proposedLifecycleActions');
    expect(REFINE_SYSTEM_ROLE).not.toContain('deleteSkill');
    expect(REFINE_SYSTEM_ROLE).not.toContain('patchSkill');
    expect(REFINE_SYSTEM_ROLE).not.toContain('rewriteSkillFile');
  });

  /**
   * @example
   * Consolidation can propose lifecycle follow-up, but cannot apply it.
   */
  it('limits consolidate output to file operations and human lifecycle proposals', () => {
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).toContain('proposedLifecycleActions');
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).toContain('updateSkill');
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).toContain('writeSkillFile');
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).toContain('removeSkillFile');
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).not.toContain('mergeSkill');
    expect(AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE).not.toContain('deleteSkill');
  });
});
