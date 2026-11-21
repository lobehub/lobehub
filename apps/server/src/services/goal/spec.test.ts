import { describe, expect, it } from 'vitest';

import { evaluateHomogeneity, uncoveredAxisValues, unitsNamedByProbes } from './spec';

describe('evaluateHomogeneity', () => {
  const spec = {
    recipeOutline: 'Replace the store with the replica-backed one',
    repeatable: true,
    unitCount: 50,
    units: Array.from({ length: 50 }, (_, i) => `Migrate ${i + 1}`),
    variants: [],
  };
  const probes = [
    { instruction: 'Migrate src/a.ts the same way', title: 'Migrate 1' },
    { instruction: 'Migrate src/b.ts the same way', title: 'Migrate 2' },
  ];

  it('accepts one repeated mould above the threshold', () => {
    expect(evaluateHomogeneity(spec, probes).batch).toBe(true);
  });

  it('accepts a roster within the caller’s batch cap', () => {
    expect(evaluateHomogeneity(spec, probes, { maxUnits: 60 }).batch).toBe(true);
  });

  it('judges a broken claim malformed, so it goes to the main Agent', () => {
    const verdict = evaluateHomogeneity(
      { ...spec, unitCount: 65, units: Array.from({ length: 65 }, (_, i) => `Migrate ${i + 1}`) },
      probes,
      { maxUnits: 60 },
    );
    expect(verdict).toMatchObject({ batch: false, malformed: true });
    expect(verdict.reasons.join(' ')).toContain('above the batch cap of 60');
    expect(evaluateHomogeneity({ ...spec, recipeOutline: undefined }, probes).malformed).toBe(true);
    expect(evaluateHomogeneity(spec, probes.slice(0, 1)).malformed).toBe(true);
  });

  it('refuses a claim whose roster does not list every claimed unit', () => {
    const verdict = evaluateHomogeneity({ ...spec, units: ['Migrate 1', 'Migrate 2'] }, probes);
    expect(verdict).toMatchObject({ batch: false, malformed: true });
    expect(verdict.reasons.join(' ')).toContain('roster lists 2 of the 50 claimed units');
  });

  /**
   * Regression: a probe the roster did not name was counted as one more unit,
   * so nine declared units plus three unrelated probes made "twelve" and the
   * batch passed — three requested units were never named and never delivered.
   */
  it('refuses a probe that is not one of the declared units', () => {
    const units = Array.from({ length: 9 }, (_, i) => `Migrate ${i + 1}`);
    const verdict = evaluateHomogeneity({ ...spec, unitCount: 12, units }, [
      { instruction: 'x', title: 'Audit the cache layer' },
      { instruction: 'x', title: 'Write the rollout doc' },
      { instruction: 'x', title: 'Benchmark cold start' },
    ]);
    expect(verdict).toMatchObject({ batch: false, malformed: true });
    expect(verdict.reasons.join(' ')).toContain('"Audit the cache layer"');
    expect(verdict.reasons.join(' ')).toContain('roster lists 9 of the 12 claimed units');
  });

  /**
   * Regression: a claim below the batch threshold was never malformed, so a
   * roster missing a unit planned ordinarily and silently dropped that unit.
   */
  it('hands over a small claim whose roster misses units, though it is no batch', () => {
    const verdict = evaluateHomogeneity(
      { ...spec, unitCount: 3, units: ['Migrate 1', 'Migrate 2'] },
      probes,
    );
    expect(verdict).toMatchObject({ batch: false, malformed: true });
    expect(verdict.reasons.join(' ')).toContain('roster lists 2 of the 3 claimed units');
    // A complete small claim is just an ordinary plan, one probe or not.
    expect(
      evaluateHomogeneity(
        { ...spec, unitCount: 3, units: ['Migrate 1', 'Migrate 2', 'Migrate 3'] },
        probes.slice(0, 1),
      ),
    ).toMatchObject({ batch: false, malformed: false });
  });

  it('keeps a goal that is simply not a batch on the ordinary plan', () => {
    expect(evaluateHomogeneity({ ...spec, repeatable: false }, probes)).toMatchObject({
      batch: false,
      malformed: false,
    });
    expect(evaluateHomogeneity({ ...spec, unitCount: 2 }, probes)).toMatchObject({
      batch: false,
      malformed: false,
    });
  });

  /**
   * Regression: the gate scored the wording of the probe briefs, which refused
   * nearly every real plan (a Chinese clause was one token; a long first probe
   * read as other work) and still could not tell an extra transformation from
   * a longer brief. The probes prove the recipe by running behind the gate.
   */
  it('does not judge the recipe from how the probe briefs are worded', () => {
    const verdict = evaluateHomogeneity(spec, [
      {
        instruction:
          '以已迁移的 store 为参照，对 src/store/device 执行：1) 定义 replica；2) 组件改为从 selector 读取；3) 删除 SWR 持久化条目；4) 补冷启动回归测试。交付物与判定标准见下。',
        title: 'Migrate 1',
      },
      { instruction: '同上，对 toolPayload 执行。', title: 'Migrate 2' },
    ]);
    expect(verdict.batch).toBe(true);
  });

  it('counts a probe once when its title wraps the unit it stands for', () => {
    const units = Array.from({ length: 12 }, (_, i) => `store${i + 1}`);
    const verdict = evaluateHomogeneity(
      { ...spec, unitCount: 12, units },
      [
        { instruction: '迁移', title: '迁移 store1 store（探针）' },
        { instruction: '迁移', title: '迁移 store2 store（探针）' },
      ],
      { maxUnits: 12 },
    );
    expect(verdict.batch).toBe(true);
  });
});

describe('unitsNamedByProbes', () => {
  /**
   * Regression: a unit with `/` or `.` fell back to substring matching, so the
   * probe `Migrate src/a.tsx` stood for the unit `src/a.ts`, which was then
   * dropped from the roster and never processed.
   */
  it('matches path and dotted unit names only on their boundaries', () => {
    expect([
      ...unitsNamedByProbes(
        ['Migrate src/a.tsx', 'Move @scope/pkg.v2'],
        ['src/a.ts', '@scope/pkg'],
      ).keys(),
    ]).toEqual([]);
    expect([
      ...unitsNamedByProbes(
        ['Migrate src/a.ts (probe)', '迁移 store.device'],
        ['src/a.ts', 'store.device'],
      ).keys(),
    ]).toEqual(['src/a.ts', 'store.device']);
    // A full stop ending the title is not more name.
    expect([...unitsNamedByProbes(['Migrate src/a.ts.'], ['src/a.ts']).keys()]).toEqual([
      'src/a.ts',
    ]);
  });

  /**
   * Regression: every unit named inside a probe title was taken as probed, so
   * the probe `agent runtime` also swallowed the separate unit `agent`.
   */
  it('lets a probe stand for one unit only, the longest name its title holds', () => {
    expect([
      ...unitsNamedByProbes(
        ['迁移 agent runtime（探针）', '迁移设备列表'],
        ['agent runtime', 'agent', '设备列表', '设备'],
      ).keys(),
    ]).toEqual(['agent runtime', '设备列表']);
  });
});

describe('uncoveredAxisValues', () => {
  it('reports a declared value no probe touches', () => {
    const gaps = uncoveredAxisValues(
      [{ axis: 'cold-start', values: ['yes', 'no'] }],
      [{ instruction: 'Handle a cold-start yes path', title: 'Probe' }],
    );
    expect(gaps).toEqual([{ axis: 'cold-start', value: 'no' }]);
  });

  it('reports nothing when every value is covered', () => {
    const gaps = uncoveredAxisValues(
      [{ axis: 'mode', values: ['cold-start'] }],
      [{ instruction: 'Handle a cold-start path', title: 'Probe' }],
    );
    expect(gaps).toEqual([]);
  });

  it('does not let an unrelated word satisfy a short variant value', () => {
    // `no` must not be covered by `node` / `nothing` — otherwise an all-`yes`
    // probe set would green the gate without ever testing the `no` variant.
    const gaps = uncoveredAxisValues(
      [{ axis: 'cold-start', values: ['no'] }],
      [{ instruction: 'Handle a node route with nothing cold', title: 'Probe' }],
    );
    expect(gaps).toEqual([{ axis: 'cold-start', value: 'no' }]);
  });
});
