import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/logger';
import { planFromResult, screenProgrammaticTestChecks } from '.';

describe('screenProgrammaticTestChecks', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('drops the repo test suites and static gates, keeping real acceptance checks', () => {
    const result = {
      cases: [
        { id: 'c1', name: '语音回复能在气泡里播放', status: 'pass' },
        { id: 'c2', name: '单元测试全部通过', status: 'pass' },
      ],
      plan: [
        { id: 'c1', title: '语音回复能在气泡里播放' },
        { id: 'c2', title: '单元测试全部通过' },
        { id: 'c3', method: 'bun run check --type', title: '类型检查无报错' },
      ],
    };

    const { droppedIds, droppedLabels } = screenProgrammaticTestChecks(result);

    expect([...droppedIds]).toEqual(['c2', 'c3']);
    expect(droppedLabels).toEqual(['c2 — 单元测试全部通过', 'c3 — 类型检查无报错']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('screens plan and cases together so a dropped item never orphans its pair', () => {
    // The plan item names the gate; the case is titled loosely. Screening only
    // one side would leave the other behind as an "unplanned" row.
    const { droppedIds } = screenProgrammaticTestChecks({
      cases: [{ id: 'c1', name: 'all green' }],
      plan: [{ id: 'c1', title: 'vitest suite passes' }],
    });

    expect([...droppedIds]).toEqual(['c1']);
  });

  it('says nothing when the round has no programmatic-test checks', () => {
    const { droppedIds, droppedLabels } = screenProgrammaticTestChecks({
      plan: [{ id: '1', title: 'the reply streams token by token' }],
    });

    expect(droppedIds.size).toBe(0);
    expect(droppedLabels).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('omits the screened ids from the frozen plan', () => {
    const result = {
      plan: [
        { id: 'c1', title: 'the reply streams token by token' },
        { id: 'c2', title: 'unit tests pass' },
      ],
    };
    const { droppedIds } = screenProgrammaticTestChecks(result);

    expect(planFromResult(result, droppedIds)!.map((item) => item.id)).toEqual(['c1']);
  });
});

describe('planFromResult — plan item normalization', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('fills every frozen-item field the author does not write', () => {
    expect(planFromResult({ plan: [{ id: '1', title: 'logs are persisted' }] })).toEqual([
      {
        description: undefined,
        id: '1',
        index: 0,
        onFail: 'manual',
        required: true,
        title: 'logs are persisted',
        verifierConfig: {},
        verifierType: 'agent',
      },
    ]);
  });

  it('honors the declared verifier instead of assuming every check is agent-judged', () => {
    const [item] = planFromResult({
      plan: [{ id: '1', title: 'cli returns a tree', verifier: 'program' }],
    })!;

    expect(item.verifierType).toBe('program');
  });

  it('carries requiredEvidence, which the executor coverage gate actually enforces', () => {
    const [item] = planFromResult({
      plan: [
        {
          id: '1',
          requiredEvidence: ['screenshot', { hint: 'the raw command output', type: 'text' }],
          title: 'ui renders',
        },
      ],
    })!;

    expect(item.verifierConfig).toEqual({
      requiredEvidence: [
        { hint: undefined, type: 'screenshot' },
        { hint: 'the raw command output', type: 'text' },
      ],
    });
  });

  it('rejects an out-of-vocabulary verifier or evidence medium', () => {
    // An unrecognized medium would gate on nothing — silently weaker than no gate.
    expect(() => planFromResult({ plan: [{ id: '1', title: 't', verifier: 'eyeball' }] })).toThrow(
      'process.exit',
    );
    expect(() =>
      planFromResult({ plan: [{ id: '1', requiredEvidence: ['vibes'], title: 't' }] }),
    ).toThrow('process.exit');
  });

  it('carries how the check would be made and what it expected', () => {
    const [item] = planFromResult({
      plan: [{ expected: 'the file exists', id: '1', method: 'tail the log', title: 'logs' }],
    })!;

    expect(item.verifierConfig).toEqual({ expected: 'the file exists', method: 'tail the log' });
  });

  it('normalizes a per-item surface and drops one that names no surface', () => {
    const items = planFromResult({
      plan: [
        { id: '1', surface: 'electron', title: 'tray dedupe' },
        { id: '2', surface: 'unit', title: 'model test' },
        { id: '3', title: 'no surface' },
      ],
    })!;

    expect(items[0].verifierConfig).toEqual({ surface: 'desktop' });
    expect(items[1].verifierConfig).toEqual({});
    expect(items[2].verifierConfig).toEqual({});
  });

  it('keys items by the same id the cases use, so results pair back to them', () => {
    const items = planFromResult({ plan: [{ id: 'case-a', title: 'a' }, { title: 'b' }] })!;

    expect(items.map((i) => i.id)).toEqual(['case-a', 'case-2']);
  });

  it('drops an item that names no check', () => {
    expect(planFromResult({ plan: [{ id: '1' }] })).toEqual([]);
  });

  it('distinguishes "no plan field" from an explicitly empty plan', () => {
    // Absent → undefined: this snapshot did not declare a plan.
    expect(planFromResult({})).toBeUndefined();

    // Present but empty → `[]`: this snapshot explicitly planned no checks.
    expect(planFromResult({ plan: [] })).toEqual([]);
  });
});
