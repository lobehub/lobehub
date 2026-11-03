import { describe, expect, it } from 'vitest';

import { SkillEngine } from '../SkillEngine';

describe('SkillEngine', () => {
  const rawSkills = [
    {
      content: '<artifacts_guide>...</artifacts_guide>',
      description: 'Generate artifacts',
      identifier: 'artifacts',
      name: 'Artifacts',
    },
    {
      content: '<agent_browser_guides>...</agent_browser_guides>',
      description: 'Browser automation',
      identifier: 'agent-browser',
      name: 'Agent Browser',
    },
    {
      description: 'LobeHub management',
      identifier: 'lobehub-cli',
      name: 'LobeHub CLI',
    },
  ];

  it('should include all skills when no enableChecker is provided', () => {
    const engine = new SkillEngine({ skills: rawSkills });
    const result = engine.generate(['artifacts']);

    expect(result.skills).toHaveLength(3);
    expect(result.enabledPluginIds).toEqual(['artifacts']);
  });

  it('should filter skills via enableChecker', () => {
    const desktopOnlySkills = new Set(['agent-browser']);
    const engine = new SkillEngine({
      enableChecker: (skill) => !desktopOnlySkills.has(skill.identifier),
      skills: rawSkills,
    });

    const result = engine.generate([]);

    expect(result.skills).toHaveLength(2);
    expect(result.skills.find((s) => s.identifier === 'agent-browser')).toBeUndefined();
  });

  it('should pass through pluginIds to OperationSkillSet', () => {
    const engine = new SkillEngine({ skills: rawSkills });
    const result = engine.generate(['artifacts', 'lobehub-cli']);

    expect(result.enabledPluginIds).toEqual(['artifacts', 'lobehub-cli']);
  });

  it('should preserve skill content in output', () => {
    const engine = new SkillEngine({ skills: rawSkills });
    const result = engine.generate([]);

    const artifacts = result.skills.find((s) => s.identifier === 'artifacts');
    expect(artifacts?.content).toBe('<artifacts_guide>...</artifacts_guide>');
  });
});
