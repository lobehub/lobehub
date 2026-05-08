import { describe, expect, it } from 'vitest';

import {
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  createAgentSkillManagerDecisionPrompt,
} from './decision';

describe('agentSkillManager decision prompt', () => {
  /**
   * @example
   * Decision prompts select target skill refs by agent document id.
   */
  it('requires strict JSON and exposes the four actions', () => {
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('create');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('refine');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('consolidate');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('noop');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('Do not wrap the JSON');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('candidateSkills[].id');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('targetSkillRefs');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('agent document ids');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('not backing documents.id values');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('targetSkillIds');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('managed skill package names');
  });

  /**
   * @example
   * Decision prompt serialization keeps stable feedback context.
   */
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
   * Decision prompts stay decision-only and never expose file operations.
   */
  it('keeps the strict decision-only JSON contract', () => {
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain(
      'output exactly one minified JSON object and nothing else',
    );
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('Do not wrap the JSON');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('Return exactly:');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).toContain('Return only the JSON object.');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('writeSkillFile');
    expect(AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE).not.toContain('updateSkill');
  });
});
