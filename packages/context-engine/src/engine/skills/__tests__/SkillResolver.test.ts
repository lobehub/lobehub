import { describe, expect, it } from 'vitest';

import { SkillResolver } from '../SkillResolver';
import type { ActivatedStepSkill, OperationSkillSet, StepSkillDelta } from '../types';

describe('SkillResolver', () => {
  const resolver = new SkillResolver();

  const baseSkills = [
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

  const emptyDelta: StepSkillDelta = { activatedSkills: [] };

  it('should mark skills as activated when their identifier is in enabledPluginIds', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: ['artifacts'],
      skills: baseSkills,
    };

    const resolved = resolver.resolve(operationSkillSet, emptyDelta);

    const artifacts = resolved.enabledSkills.find((s) => s.identifier === 'artifacts');
    expect(artifacts?.activated).toBe(true);
    expect(artifacts?.content).toBe('<artifacts_guide>...</artifacts_guide>');

    const browser = resolved.enabledSkills.find((s) => s.identifier === 'agent-browser');
    expect(browser?.activated).toBeUndefined();
  });

  it('should include all skills in enabledSkills (activated and non-activated)', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: [],
      skills: baseSkills,
    };

    const resolved = resolver.resolve(operationSkillSet, emptyDelta);
    expect(resolved.enabledSkills).toHaveLength(3);
  });

  it('should activate skills from step delta', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: [],
      skills: baseSkills,
    };
    const delta: StepSkillDelta = {
      activatedSkills: [{ content: 'step-injected content', identifier: 'agent-browser' }],
    };

    const resolved = resolver.resolve(operationSkillSet, delta);

    const browser = resolved.enabledSkills.find((s) => s.identifier === 'agent-browser');
    expect(browser?.activated).toBe(true);
    expect(browser?.content).toBe('step-injected content');
  });

  it('should activate skills from accumulated previous steps', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: [],
      skills: baseSkills,
    };
    const accumulated: ActivatedStepSkill[] = [
      { activatedAtStep: 1, content: 'accumulated content', identifier: 'lobehub-cli' },
    ];

    const resolved = resolver.resolve(operationSkillSet, emptyDelta, accumulated);

    const cli = resolved.enabledSkills.find((s) => s.identifier === 'lobehub-cli');
    expect(cli?.activated).toBe(true);
    expect(cli?.content).toBe('accumulated content');
  });

  it('should merge operation + accumulated + step delta activations', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: ['artifacts'],
      skills: baseSkills,
    };
    const delta: StepSkillDelta = {
      activatedSkills: [{ identifier: 'agent-browser' }],
    };
    const accumulated: ActivatedStepSkill[] = [{ activatedAtStep: 0, identifier: 'lobehub-cli' }];

    const resolved = resolver.resolve(operationSkillSet, delta, accumulated);

    expect(resolved.enabledSkills.filter((s) => s.activated)).toHaveLength(3);
  });

  it('should let step delta content override original content', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: ['artifacts'],
      skills: baseSkills,
    };
    const delta: StepSkillDelta = {
      activatedSkills: [{ content: 'overridden', identifier: 'artifacts' }],
    };

    const resolved = resolver.resolve(operationSkillSet, delta);

    const artifacts = resolved.enabledSkills.find((s) => s.identifier === 'artifacts');
    expect(artifacts?.activated).toBe(true);
    expect(artifacts?.content).toBe('overridden');
  });

  it('should let accumulated content override original but step delta wins', () => {
    const operationSkillSet: OperationSkillSet = {
      enabledPluginIds: [],
      skills: baseSkills,
    };
    const accumulated: ActivatedStepSkill[] = [
      { activatedAtStep: 0, content: 'from-accumulated', identifier: 'artifacts' },
    ];
    const delta: StepSkillDelta = {
      activatedSkills: [{ content: 'from-delta', identifier: 'artifacts' }],
    };

    const resolved = resolver.resolve(operationSkillSet, delta, accumulated);

    const artifacts = resolved.enabledSkills.find((s) => s.identifier === 'artifacts');
    expect(artifacts?.content).toBe('from-delta');
  });
});
