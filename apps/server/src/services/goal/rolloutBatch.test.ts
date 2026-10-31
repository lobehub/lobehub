import { describe, expect, it } from 'vitest';

import { carriedUnitBrief, normalizeRolloutRoster, rerunUnitNote } from './rolloutBatch';

describe('normalizeRolloutRoster', () => {
  const probes = (...titles: string[]) => titles.map((title) => ({ title }));

  it('does not queue a unit again when a probe title wraps its name', () => {
    expect(
      normalizeRolloutRoster(
        ['device', 'toolPayload', 'brief'],
        probes('迁移 device store（探针）'),
        1,
        undefined,
        { matchUnitInProbeTitle: true },
      ),
    ).toEqual(['迁移 device store（探针）', 'toolPayload', 'brief']);
  });

  /**
   * Regression: every unit named inside a probe title was dropped, so the probe
   * `agent runtime` also swallowed the separate unit `agent`, which then never
   * ran.
   */
  it('lets a probe stand for one unit only, the longest name its title holds', () => {
    expect(
      normalizeRolloutRoster(
        ['agent runtime', 'agent', '设备列表', '设备'],
        probes('迁移 agent runtime（探针）', '迁移设备列表'),
        2,
        undefined,
        { matchUnitInProbeTitle: true },
      ),
    ).toEqual(['迁移 agent runtime（探针）', '迁移设备列表', 'agent', '设备']);
  });

  it('keeps exact titles only for a roster a person or Agent wrote', () => {
    expect(normalizeRolloutRoster(['Device list', 'Device'], probes('Device list'), 1)).toEqual([
      'Device list',
      'Device',
    ]);
  });
});

describe('carriedUnitBrief', () => {
  const brief = (...sections: string[]) => ({ description: sections.join('\n\n'), title: 'A1' });

  it('keeps the unit brief but not the note of the re-run it was carried into', () => {
    // A unit re-run once, now re-opened again: its own brief travels on, the
    // earlier re-run's note does not pile up under the next one.
    const node = brief(
      'Follow the plan skill.\n\nUnit: A1',
      'Unit brief (from its first run):\n[origin=rework] PR #20858',
      `Re-run on the revised plan:\n${rerunUnitNote('过 codex review', ['PR #20858 https://github.com/lobehub/lobehub/pull/20858'])}`,
    );

    expect(carriedUnitBrief(node)).toBe('[origin=rework] PR #20858');
  });

  it('carries nothing for a unit briefed only from the plan skill', () => {
    // The plan text in such a brief is the version it ran on — carrying it
    // would hand a re-run the very plan the owner sent back.
    const node = brief(
      'Unit: A1',
      "Do this unit by the batch's execution plan, the skill `plan` loaded for this run.",
      'If that skill is not loaded in this run, follow the plan as it stood at dispatch:\n\nv1 plan',
    );

    expect(carriedUnitBrief(node)).toBeUndefined();
  });

  // A planner may write its own probe instruction under the same `Unit:` line;
  // only the generated plan-skill brief is boilerplate.
  it('keeps a planner instruction that opens with the unit line', () => {
    const node = brief('Unit: A1\nVariant: desktop\nCover the Electron window only.');

    expect(carriedUnitBrief(node)).toBe(
      'Unit: A1\nVariant: desktop\nCover the Electron window only.',
    );
  });

  it('carries nothing for a re-run briefed only from the shared plan', () => {
    const node = brief(
      'Follow the plan skill.\n\nUnit: A1',
      `Re-run on the revised plan:\n${rerunUnitNote('过 codex review', [])}`,
    );

    expect(carriedUnitBrief(node)).toBeUndefined();
  });
});

describe('rerunUnitNote', () => {
  it('points the re-run at its earlier delivery so it continues rather than duplicates it', () => {
    const note = rerunUnitNote('过 codex review', ['PR #1 https://example.com/pull/1']);

    expect(note).toContain('过 codex review');
    expect(note).toContain('- PR #1 https://example.com/pull/1');
    expect(note).toContain('do not open a second one');
  });
});
