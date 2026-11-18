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
  const all = {
    availableSkillIds: ['project:review', 'db-review', 'agent-skills:review', 'builtin-review'],
  };

  it('resolves a name collision as project > db > agent-skills > builtin', () => {
    const pool = assembleSkillPool(
      {
        agentSkills: [skill('agent-skills:review', 'review')],
        builtin: [skill('builtin-review', 'review')],
        db: [skill('db-review', 'review')],
        project: [skill('project:review', 'review')],
      },
      all,
    );
    expect(pool.skills.map((s) => s.identifier)).toEqual(['project:review']);

    const withoutProject = assembleSkillPool(
      {
        agentSkills: [skill('agent-skills:review', 'review')],
        builtin: [skill('builtin-review', 'review')],
        db: [skill('db-review', 'review')],
      },
      all,
    );
    expect(withoutProject.skills.map((s) => s.identifier)).toEqual(['db-review']);
  });

  it('keeps distinct names from every source, in precedence order', () => {
    const pool = assembleSkillPool(
      {
        agentSkills: [skill('agent-skills:notes', 'agent-skills:notes')],
        builtin: [skill('artifacts')],
        db: [skill('my-skill')],
        project: [skill('project:deploy', 'deploy')],
      },
      { availableSkillIds: ['project:deploy', 'my-skill', 'agent-skills:notes', 'artifacts'] },
    );
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
      { availableSkillIds: ['gone', 'kept', 'artifacts'], disabledIds: ['gone'] },
    );
    expect(pool.skills.map((s) => s.identifier)).toEqual(['kept', 'artifacts']);
  });

  it('withholds everything a share configuration does not allow', () => {
    const sources = { builtin: [skill('artifacts')], db: [skill('shared'), skill('private')] };
    expect(
      assembleSkillPool(sources, {
        availableSkillIds: ['shared', 'private', 'artifacts'],
        shareAllowedIds: ['shared'],
      }).skills.map((s) => s.identifier),
    ).toEqual(['shared']);
    // An empty allowlist collapses the pool; no allowlist means no gate.
    expect(assembleSkillPool(sources, { shareAllowedIds: [] }).skills).toEqual([]);
    expect(
      assembleSkillPool(sources, { availableSkillIds: ['shared', 'private', 'artifacts'] }).skills,
    ).toHaveLength(3);
  });

  it('gates the device-only builtin on the run, not on the host', () => {
    const sources = { builtin: [skill(AgentBrowserIdentifier), skill('artifacts')] };
    const availableSkillIds = [AgentBrowserIdentifier, 'artifacts'];
    expect(
      assembleSkillPool(sources, { availableSkillIds }).skills.map((s) => s.identifier),
    ).toEqual(['artifacts']);
    expect(
      assembleSkillPool(sources, { availableSkillIds, canExecuteOnDevice: true }).skills.map(
        (s) => s.identifier,
      ),
    ).toEqual([AgentBrowserIdentifier, 'artifacts']);
  });

  it('exposes only enabled skills, without pre-activating them', () => {
    const sources = { builtin: [skill('on'), skill('off')], db: [skill('disabled')] };
    expect(assembleSkillPool(sources).skills).toEqual([]);
    const pool = assembleSkillPool(sources, {
      availableSkillIds: ['on', 'disabled'],
      disabledIds: ['disabled'],
    });
    expect(pool.skills.map((s) => s.identifier)).toEqual(['on']);
    expect(pool.enabledPluginIds).toEqual([]);
  });
});
