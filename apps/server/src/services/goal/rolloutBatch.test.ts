import { describe, expect, it } from 'vitest';

import { normalizeRolloutRoster } from './rolloutBatch';

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
