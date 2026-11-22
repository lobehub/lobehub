import { AgentBrowserIdentifier } from '@lobechat/builtin-skills/manifests';
import type { SkillMeta } from '@lobechat/context-engine';
import { describe, expect, it } from 'vitest';

import { assembleSkillPool, isBuiltinSkillEnabled } from './skillPool';

const skill = (identifier: string, name = identifier, extra: Partial<SkillMeta> = {}): SkillMeta =>
  ({ description: '', identifier, name, ...extra }) as SkillMeta;

describe('isBuiltinSkillEnabled', () => {
  it('gates only the device-only skills', () => {
    expect(isBuiltinSkillEnabled(AgentBrowserIdentifier, { canExecuteOnDevice: false })).toBe(
      false,
    );
    expect(isBuiltinSkillEnabled(AgentBrowserIdentifier, { canExecuteOnDevice: true })).toBe(true);
    expect(isBuiltinSkillEnabled('artifacts', { canExecuteOnDevice: false })).toBe(true);
  });
});

describe('assembleSkillPool', () => {
  it('resolves a name collision as project > db > agent-skills > builtin', () => {
    const pool = assembleSkillPool(
      {
        agentSkills: [skill('agent-skills:review', 'review')],
        builtin: [skill('builtin-review', 'review')],
        db: [skill('db-review', 'review')],
        project: [skill('project:review', 'review')],
      },
      { autoSkillIds: ['db-review'] },
    );
    expect(pool.skills.map((s) => s.identifier)).toEqual(['project:review']);

    const withoutProject = assembleSkillPool(
      {
        agentSkills: [skill('agent-skills:review', 'review')],
        builtin: [skill('builtin-review', 'review')],
        db: [skill('db-review', 'review')],
      },
      { autoSkillIds: ['db-review'] },
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
      { autoSkillIds: ['my-skill', 'artifacts'] },
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
      { autoSkillIds: ['gone', 'kept'], disabledIds: ['gone'] },
    );
    expect(pool.skills.map((s) => s.identifier)).toEqual(['kept']);
  });

  it('leaves out a library skill the agent never turned on, including unselected builtin skills', () => {
    const sources = {
      agentSkills: [skill('agent-skills:notes')],
      builtin: [skill('artifacts')],
      db: [skill('pinned'), skill('auto'), skill('untouched')],
      project: [skill('project:deploy', 'deploy')],
    };
    const pool = assembleSkillPool(sources, {
      autoSkillIds: ['auto'],
      enabledPluginIds: ['pinned'],
    });
    expect(pool.skills.map((s) => s.identifier)).toEqual([
      'project:deploy',
      'pinned',
      'auto',
      'agent-skills:notes',
    ]);

    // A saved auto entry is a user choice, including on legacy manual agents (for both DB and agent skills).
    expect(
      assembleSkillPool(sources, {
        autoSkillIds: ['auto', 'agent-skills:notes'],
        enabledPluginIds: ['pinned'],
        skillActivateMode: 'manual',
      }).skills.map((s) => s.identifier),
    ).toEqual(['project:deploy', 'pinned', 'auto', 'agent-skills:notes']);
  });

  it('withholds everything a share configuration does not allow', () => {
    const sources = { builtin: [skill('artifacts')], db: [skill('shared'), skill('private')] };
    const autoSkillIds = ['shared', 'private'];
    expect(
      assembleSkillPool(sources, { autoSkillIds, shareAllowedIds: ['shared'] }).skills.map(
        (s) => s.identifier,
      ),
    ).toEqual(['shared']);
    // An empty allowlist collapses the pool; no allowlist means no gate.
    expect(assembleSkillPool(sources, { autoSkillIds, shareAllowedIds: [] }).skills).toEqual([]);
    expect(assembleSkillPool(sources, { autoSkillIds }).skills).toHaveLength(2);
  });

  it('gates the device-only builtin on the run, not on the host', () => {
    const sources = { builtin: [skill(AgentBrowserIdentifier), skill('artifacts')] };
    const autoSkillIds = [AgentBrowserIdentifier, 'artifacts'];
    expect(assembleSkillPool(sources).skills).toEqual([]);
    expect(assembleSkillPool(sources, { autoSkillIds }).skills.map((s) => s.identifier)).toEqual([
      'artifacts',
    ]);
    expect(
      assembleSkillPool(sources, { autoSkillIds, canExecuteOnDevice: true }).skills.map(
        (s) => s.identifier,
      ),
    ).toEqual([AgentBrowserIdentifier, 'artifacts']);
  });

  it('keeps a turn skill selectable in manual mode without pinning it', () => {
    const pool = assembleSkillPool(
      { builtin: [skill('lobehub'), skill('artifacts')], db: [skill('picked')] },
      { enabledPluginIds: ['picked'], skillActivateMode: 'manual', turnSkillIds: ['lobehub'] },
    );

    expect(pool.skills.map((s) => s.identifier)).toEqual(['picked', 'lobehub']);
    expect(pool.enabledPluginIds).toEqual(['picked']);
  });

  it('still lets a share configuration withhold a turn skill', () => {
    const pool = assembleSkillPool(
      { builtin: [skill('lobehub')] },
      { shareAllowedIds: [], skillActivateMode: 'manual', turnSkillIds: ['lobehub'] },
    );

    expect(pool.skills).toEqual([]);
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
    // Auto mode brings back the sources the agent does not opt into one by one;
    // a library skill it never turned on stays out either way.
    expect(auto.skills.map((s) => s.identifier)).toEqual([
      'project:deploy',
      'picked',
      'agent-skills:notes',
    ]);
  });

  it('pairs the pool with the run’s enabled plugin ids for the resolver', () => {
    const pool = assembleSkillPool(
      { db: [skill('pinned'), skill('listed')] },
      { autoSkillIds: ['listed'], enabledPluginIds: ['pinned'] },
    );
    expect(pool.enabledPluginIds).toEqual(['pinned']);
    expect(pool.skills.map((s) => s.identifier)).toEqual(['pinned', 'listed']);
  });
});
