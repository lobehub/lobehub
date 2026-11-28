import { describe, expect, it } from 'vitest';

import {
  resourcesTreePrompt,
  type SkillItem,
  skillPrompt,
  SKILLS_LIST_CHAR_BUDGET,
  skillsPrompts,
} from './index';

describe('skillPrompt', () => {
  it('should generate skill tag with location', () => {
    const skill: SkillItem = {
      description: 'Extracts text and tables from PDF files',
      identifier: 'pdf-processing',
      location: '/path/to/skills/pdf-processing/SKILL.md',
      name: 'PDF Processing',
    };

    expect(skillPrompt(skill)).toBe(
      '  <skill name="PDF Processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>',
    );
  });

  it('should generate skill tag without location', () => {
    const skill: SkillItem = {
      description: 'Custom skill description',
      identifier: 'my-skill',
      name: 'My Skill',
    };

    expect(skillPrompt(skill)).toBe('  <skill name="My Skill">Custom skill description</skill>');
  });
});

describe('skillsPrompts', () => {
  it('should generate available_skills block with multiple skills', () => {
    const skills: SkillItem[] = [
      {
        description: 'Extracts text and tables from PDF files',
        identifier: 'pdf-processing',
        location: '/path/to/skills/pdf-processing/SKILL.md',
        name: 'PDF Processing',
      },
      {
        description: 'Analyzes datasets and generates charts',
        identifier: 'data-analysis',
        location: '/path/to/skills/data-analysis/SKILL.md',
        name: 'Data Analysis',
      },
    ];

    const expected = `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.

<available_skills>
  <skill name="PDF Processing" location="/path/to/skills/pdf-processing/SKILL.md">Extracts text and tables from PDF files</skill>
  <skill name="Data Analysis" location="/path/to/skills/data-analysis/SKILL.md">Analyzes datasets and generates charts</skill>
</available_skills>`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should generate mixed skills with and without location', () => {
    const skills: SkillItem[] = [
      {
        description: 'Generate interactive UI components',
        identifier: 'artifacts',
        location: '/path/to/skills/artifacts/SKILL.md',
        name: 'Artifacts',
      },
      {
        description: 'Custom skill description',
        identifier: 'my-skill',
        name: 'My Skill',
      },
    ];

    const expected = `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.

<available_skills>
  <skill name="Artifacts" location="/path/to/skills/artifacts/SKILL.md">Generate interactive UI components</skill>
  <skill name="My Skill">Custom skill description</skill>
</available_skills>`;

    expect(skillsPrompts(skills)).toBe(expected);
  });

  it('should direct project/device skills through activateSkill with relative-path guidance', () => {
    const skills: SkillItem[] = [
      {
        description: 'Device writing guidance',
        identifier: 'device:writing',
        location: '/Users/dev/.agents/skills/writing/SKILL.md',
        name: 'writing',
        source: 'device',
      },
    ];

    expect(skillsPrompts(skills)).toBe(
      `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.
For a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile) and resolve relative paths against the parent directory of its \`location\` (parent of SKILL.md).

<available_skills>
  <skill name="writing" source="device" location="/Users/dev/.agents/skills/writing/SKILL.md">Device writing guidance</skill>
</available_skills>`,
    );
  });

  it('should keep the readFile route for project/device skills when activateSkill was not sent', () => {
    const skills: SkillItem[] = [
      {
        description: 'Device writing guidance',
        identifier: 'device:writing',
        location: '/Users/dev/.agents/skills/writing/SKILL.md',
        name: 'writing',
        source: 'device',
      },
    ];

    const prompt = skillsPrompts(skills, { canActivateSkill: false });

    expect(prompt).toContain(
      'For a skill with source="project" or source="device", load it by calling the readFile tool on its `location` path and resolve relative paths against its parent directory (parent of SKILL.md).',
    );
    expect(prompt).not.toContain('do not bypass activation with readFile');
  });

  it('should return empty string for empty skills array', () => {
    expect(skillsPrompts([])).toBe('');
  });
});

describe('resourcesTreePrompt', () => {
  it('instructs readReference with the manifest parameter name `id` rather than `skillName`', () => {
    const prompt = resourcesTreePrompt('pdf-tools', {
      'references/guide.md': { fileHash: 'h1', size: 120 },
    });

    expect(prompt).toContain('Use `readReference` with id="pdf-tools"');
    expect(prompt).not.toContain('skillName=');
    expect(prompt).toContain('guide.md');
  });
});

describe('skillsPrompts list budget', () => {
  /**
   * Mirrors issue lobehub#22284: a device with 483 skills whose descriptions
   * follow real SKILL.md lengths (median ~225 chars, long tail to ~1000).
   */
  const manyDeviceSkills = (count: number): SkillItem[] =>
    Array.from({ length: count }, (_, i) => {
      const name = `device-skill-${i}`;
      return {
        description: `Use when the task involves topic ${i}. `.repeat(1 + (i % 25)),
        identifier: `device:${name}`,
        location: `/Users/dev/.claude/skills/${name}/SKILL.md`,
        name,
        source: 'device',
      };
    });

  it('keeps hundreds of device skills within the list budget while naming every skill', () => {
    const skills = manyDeviceSkills(483);
    const prompt = skillsPrompts(skills);

    expect(prompt.length).toBeLessThanOrEqual(SKILLS_LIST_CHAR_BUDGET);
    for (const skill of skills) expect(prompt).toContain(`name="${skill.name}"`);
    // activateSkill loads a filesystem skill by name, so the path is not needed
    expect(prompt).not.toContain('location=');
    expect(prompt).toContain('activateSkill');
  });

  it('keeps the readFile path of every listed skill when activateSkill was not sent', () => {
    const skills = manyDeviceSkills(483);
    const prompt = skillsPrompts(skills, { canActivateSkill: false });

    expect(prompt.length).toBeLessThanOrEqual(SKILLS_LIST_CHAR_BUDGET);
    expect(prompt).toContain(`location="${skills[0].location}"`);
    expect(prompt).toContain('readFile tool on its `location` path');
    expect(prompt).not.toContain('a miss returns');
    expect(prompt).not.toContain('activateSkill loads');
  });

  it('lists what fits and points at activateSkill when even bare names exceed the budget', () => {
    const skills = manyDeviceSkills(5000);
    const prompt = skillsPrompts(skills);

    expect(prompt.length).toBeLessThanOrEqual(SKILLS_LIST_CHAR_BUDGET);
    expect(prompt).toContain('name="device-skill-0"');
    expect(prompt).toMatch(/\d+ more skills are not listed/);
  });

  it('renders a list under the budget exactly as before', () => {
    const skills = manyDeviceSkills(20);
    const full = skillsPrompts(skills);

    expect(full.length).toBeLessThan(SKILLS_LIST_CHAR_BUDGET);
    for (const skill of skills) expect(full).toContain(skillPrompt(skill));
  });
});
