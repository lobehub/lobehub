import { describe, expect, it } from 'vitest';

import { type SkillItem, skillPrompt, skillsPrompts } from './index';

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

  it('should include filesystem skill loading and relative-path resolution instructions for project/device skills', () => {
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
For a skill with source="project" or source="device", load it by calling the readFile tool on its \`location\` path and resolve relative paths against its parent directory (parent of SKILL.md).

<available_skills>
  <skill name="writing" source="device" location="/Users/dev/.agents/skills/writing/SKILL.md">Device writing guidance</skill>
</available_skills>`,
    );
  });

  it('should return empty string for empty skills array', () => {
    expect(skillsPrompts([])).toBe('');
  });
});
