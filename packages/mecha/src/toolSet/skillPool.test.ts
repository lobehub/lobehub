import { AgentBrowserIdentifier } from '@lobechat/builtin-skills/manifests';
import type { SkillMeta } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { assembleSkillPool, isBuiltinSkillEnabled } from './skillPool';

const skill = (identifier: string, name = identifier, extra: Partial<SkillMeta> = {}): SkillMeta =>
  ({ description: '', identifier, name, ...extra }) as SkillMeta;

describe('isBuiltinSkillEnabled', () => {
  it('hides the product-driven skills and gates the device-only ones', () => {
    expect(isBuiltinSkillEnabled('task', { canExecuteOnDevice: true })).toBe(false);
    expect(isBuiltinSkillEnabled(AgentBrowserIdentifier, { canExecuteOnDevice: false })).toBe(
      false,
    );
    expect(isBuiltinSkillEnabled(AgentBrowserIdentifier, { canExecuteOnDevice: true })).toBe(true);
    expect(isBuiltinSkillEnabled('artifacts', { canExecuteOnDevice: false })).toBe(true);
  });
});

describe('assembleSkillPool', () => {
  it('resolves a name collision as project > db > agent-skills > builtin', () => {
    const pool = assembleSkillPool({
      agentSkills: [skill('agent-skills:review', 'review')],
      builtin: [skill('builtin-review', 'review')],
      db: [skill('db-review', 'review')],
      project: [skill('project:review', 'review')],
    });
    expect(pool.skills.map((s) => s.identifier)).toEqual(['project:review']);

    const withoutProject = assembleSkillPool({
      agentSkills: [skill('agent-skills:review', 'review')],
      builtin: [skill('builtin-review', 'review')],
      db: [skill('db-review', 'review')],
    });
    expect(withoutProject.skills.map((s) => s.identifier)).toEqual(['db-review']);
  });

  it('keeps distinct names from every source, in precedence order', () => {
    const pool = assembleSkillPool({
      agentSkills: [skill('agent-skills:notes', 'agent-skills:notes')],
      builtin: [skill('artifacts')],
      db: [skill('my-skill')],
      project: [skill('project:deploy', 'deploy')],
    });
    expect(pool.skills.map((s) => s.identifier)).toEqual([
      'project:deploy',
      'my-skill',
      'agent-skills:notes',
      'artifacts',
    ]);
  });

  it('drops disabled skills from the pool, so they are neither listed nor activatable', () => {
    const pool = assembleSkillPool(
      { builtin: [skill('artifacts')], db: [skill('gone'), skill('kept')] },
      { disabledIds: ['gone'] },
    );
    expect(pool.skills.map((s) => s.identifier)).toEqual(['kept', 'artifacts']);
  });

  it('withholds everything a share configuration does not allow', () => {
    const sources = { builtin: [skill('artifacts')], db: [skill('shared'), skill('private')] };
    expect(
      assembleSkillPool(sources, { shareAllowedIds: ['shared'] }).skills.map((s) => s.identifier),
    ).toEqual(['shared']);
    // An empty allowlist collapses the pool; no allowlist means no gate.
    expect(assembleSkillPool(sources, { shareAllowedIds: [] }).skills).toEqual([]);
    expect(assembleSkillPool(sources).skills).toHaveLength(3);
  });

  it('gates the device-only builtin on the run, not on the host', () => {
    const sources = { builtin: [skill(AgentBrowserIdentifier), skill('artifacts')] };
    expect(assembleSkillPool(sources).skills.map((s) => s.identifier)).toEqual(['artifacts']);
    expect(
      assembleSkillPool(sources, { canExecuteOnDevice: true }).skills.map((s) => s.identifier),
    ).toEqual([AgentBrowserIdentifier, 'artifacts']);
  });

  it('exposes only the selected skills in manual mode, keeping the discovered project ones', () => {
    const sources = {
      agentSkills: [skill('agent-skills:notes', 'agent-skills:notes')],
      builtin: [skill('artifacts')],
      db: [skill('picked'), skill('not-picked')],
      // Project / device skills come from the working directory and can never
      // be picked in the UI, so the mode does not speak about them.
      project: [skill('project:deploy', 'deploy')],
    };

    const manual = assembleSkillPool(sources, {
      enabledPluginIds: ['picked'],
      skillActivateMode: 'manual',
    });
    expect(manual.skills.map((s) => s.identifier)).toEqual(['project:deploy', 'picked']);

    const auto = assembleSkillPool(sources, {
      enabledPluginIds: ['picked'],
      skillActivateMode: 'auto',
    });
    expect(auto.skills.map((s) => s.identifier)).toEqual([
      'project:deploy',
      'picked',
      'not-picked',
      'agent-skills:notes',
      'artifacts',
    ]);
  });

  it('pairs the pool with the run’s enabled plugin ids for the resolver', () => {
    const pool = assembleSkillPool(
      { db: [skill('pinned'), skill('listed')] },
      { enabledPluginIds: ['pinned'] },
    );
    expect(pool.enabledPluginIds).toEqual(['pinned']);
    expect(pool.skills.map((s) => s.identifier)).toEqual(['pinned', 'listed']);
  });
});
