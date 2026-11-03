import { describe, expect, it } from 'vitest';

import {
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  AGENT_SKILL_CREATE_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  createAgentSkillConsolidatePrompt,
  createAgentSkillCreatePrompt,
  createAgentSkillRefinePrompt,
} from './index';

const authoringRoles = [
  AGENT_SKILL_CREATE_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
];

describe('agent skill authoring prompts', () => {
  /**
   * @example
   * Skill authoring prompts follow the same JSON generation layout as other prompt chains.
   */
  it('uses the repo structured-generation prompt style', () => {
    for (const role of authoringRoles) {
      expect(role).toContain('Your job is');
      expect(role).toContain('Output a JSON object with these fields:');
      expect(role).toContain('Rules:');
      expect(role).toContain('Examples:');
      expect(role).toContain('Output ONLY the JSON object, no markdown fences or explanations.');
    }
  });

  /**
   * @example
   * Skill authoring prompts must not regress to the old path/file operation contract.
   */
  it('forbids the old file-operation contract', () => {
    for (const role of authoringRoles) {
      expect(role).not.toContain('updateSkill');
      expect(role).not.toContain('writeSkillFile');
      expect(role).not.toContain('removeSkillFile');
      expect(role).not.toContain('readSkillFile');
      expect(role).not.toContain('Valid output:');
    }
  });

  /**
   * @example
   * Skill authoring prompts make the model own metadata and body content.
   */
  it('requires prompt-owned skill metadata and body authoring', () => {
    for (const role of authoringRoles) {
      expect(role).toContain('description is the activation');
      expect(role).toContain('bodyMarkdown');
      expect(role).toContain('no YAML frontmatter');
      expect(role).toContain('runtime will not infer');
    }
  });

  /**
   * @example
   * Create authoring keeps trigger/provenance context out of persisted skill body markdown.
   */
  it('keeps activation and provenance sections out of create bodyMarkdown', () => {
    expect(AGENT_SKILL_CREATE_SYSTEM_ROLE).toContain(
      'Put activation conditions only in description',
    );
    expect(AGENT_SKILL_CREATE_SYSTEM_ROLE).toContain(
      'Do not add bodyMarkdown sections named Trigger',
    );
  });

  /**
   * @example
   * Skill authoring prompts include caller-supplied artifact language instructions.
   */
  it('renders artifact language instructions in authoring prompts', () => {
    const languageInstruction = [
      'Skill artifact language rules:',
      '- Explicit user language instruction wins.',
    ].join('\n');
    const prompts = [
      createAgentSkillCreatePrompt({
        agentId: 'agent-1',
        evidence: [{ cue: 'future', excerpt: 'Use this checklist later.' }],
        feedbackMessage: 'Keep this as a reusable checklist.',
        languageInstruction,
      }),
      createAgentSkillRefinePrompt({
        languageInstruction,
        reason: 'New evidence',
        skillContent: '# Existing',
        skillMetadata: {},
      }),
      createAgentSkillConsolidatePrompt({
        languageInstruction,
        reason: 'Overlap',
        sourceSkills: [{ content: '# A', id: 'skill-1', metadata: {} }],
      }),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain('Skill artifact language rules:');
      expect(prompt).toContain('Explicit user language instruction wins.');
    }
  });
});
