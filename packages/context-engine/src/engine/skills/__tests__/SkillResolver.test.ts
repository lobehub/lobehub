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

    // `lobehub-cli` has no content anywhere (neither its own base definition
    // nor the accumulated activation) — see the dedicated content-guard
    // tests below for why it's correctly excluded here rather than being
    // force-activated with nothing to show.
    expect(resolved.enabledSkills.filter((s) => s.activated)).toHaveLength(2);
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

  describe('content guard — a pinned/activated skill with no content must not vanish', () => {
    // Regression test: a ZIP-bundled skill deliberately has no pre-fetched
    // `content` (resolveClientSkills / aiAgent's skills build withhold it
    // until `activateSkill` mounts the bundle). Before this fix, being pinned
    // alone forced `activated: true` with `content: undefined` — and
    // SkillContextProvider's `activated && content` / `!activated` filters
    // both reject that combination, making the skill invisible in the
    // injected prompt entirely (neither auto-injected nor listed as
    // available for the model to discover and activate).
    const bundledSkill = {
      description: 'A skill whose content requires activation to mount',
      identifier: 'pptx',
      name: 'PPTX',
      // no `content` — mirrors a ZIP-bundled skill pre-activation
    };

    it('does not mark a pinned skill activated when it has no content', () => {
      const operationSkillSet: OperationSkillSet = {
        enabledPluginIds: ['pptx'],
        skills: [bundledSkill],
      };

      const resolved = resolver.resolve(operationSkillSet, emptyDelta);

      const pptx = resolved.enabledSkills.find((s) => s.identifier === 'pptx');
      // Falls through as a plain (non-activated) entry — visible to
      // SkillContextProvider's `!activated` (available) bucket instead of
      // vanishing.
      expect(pptx?.activated).toBeUndefined();
      expect(pptx?.content).toBeUndefined();
    });

    it('activates it once a step delta supplies real content (post-activateSkill)', () => {
      const operationSkillSet: OperationSkillSet = {
        enabledPluginIds: ['pptx'],
        skills: [bundledSkill],
      };
      const delta: StepSkillDelta = {
        activatedSkills: [{ content: 'mounted skill content', identifier: 'pptx' }],
      };

      const resolved = resolver.resolve(operationSkillSet, delta);

      const pptx = resolved.enabledSkills.find((s) => s.identifier === 'pptx');
      expect(pptx?.activated).toBe(true);
      expect(pptx?.content).toBe('mounted skill content');
    });
  });
});
