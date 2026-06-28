import { describe, expect, it } from 'vitest';

import { shouldFoldProcess, splitFinalAnswer } from './segments';

const a = (id: string) => ({ block: { id } as any, kind: 'answer' as const });
const w = (id: string) => ({ blocks: [{ id } as any], kind: 'workflow' as const });

describe('splitFinalAnswer', () => {
  it('treats the trailing run of answer segments as the final answer', () => {
    const segments = [w('t1'), a('intro'), w('t2'), a('final')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    // intro prose + both tool segments fold into the process
    expect(processSegments).toEqual([w('t1'), a('intro'), w('t2')]);
    expect(finalSegments).toEqual([a('final')]);
  });

  it('keeps multiple trailing answer segments together as the final answer', () => {
    const segments = [w('t1'), a('a1'), a('a2')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    expect(processSegments).toEqual([w('t1')]);
    expect(finalSegments).toEqual([a('a1'), a('a2')]);
  });

  it('keeps the final answer visible when a trailing bookkeeping tool follows it', () => {
    // The agent writes its summary, then ends the turn on a "mark task done" tool
    // call. The answer must stay out of the fold; only the trailing tool folds.
    const segments = [w('t1'), a('intro'), w('t2'), a('summary'), w('mark-done')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    expect(processSegments).toEqual([w('t1'), a('intro'), w('t2'), w('mark-done')]);
    expect(finalSegments).toEqual([a('summary')]);
  });

  it('surfaces the lone answer even when the turn ends on a workflow segment', () => {
    const segments = [a('intro'), w('t1')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    expect(processSegments).toEqual([w('t1')]);
    expect(finalSegments).toEqual([a('intro')]);
  });

  it('folds everything when the turn has no answer segment at all', () => {
    const segments = [w('t1'), w('t2')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    expect(processSegments).toEqual([w('t1'), w('t2')]);
    expect(finalSegments).toEqual([]);
  });

  it('treats a pure-answer turn as all final, nothing to fold', () => {
    const segments = [a('only')];
    const { processSegments, finalSegments } = splitFinalAnswer(segments);
    expect(processSegments).toEqual([]);
    expect(finalSegments).toEqual([a('only')]);
  });
});

describe('shouldFoldProcess', () => {
  const proc = [w('t1')];

  it('folds a finished, non-latest turn that has a workflow when enabled', () => {
    expect(shouldFoldProcess({ enabled: true, isGenerating: false, processSegments: proc })).toBe(
      true,
    );
  });

  it('never folds when the lab flag is disabled', () => {
    expect(shouldFoldProcess({ enabled: false, isGenerating: false, processSegments: proc })).toBe(
      false,
    );
    expect(shouldFoldProcess({ isGenerating: false, processSegments: proc })).toBe(false);
  });

  it('never folds the latest turn', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        isGenerating: false,
        isLatestItem: true,
        processSegments: proc,
      }),
    ).toBe(false);
  });

  it('never folds while generating', () => {
    expect(shouldFoldProcess({ enabled: true, isGenerating: true, processSegments: proc })).toBe(
      false,
    );
  });

  it('does not fold when the process has no workflow (e.g. pure prose)', () => {
    expect(
      shouldFoldProcess({ enabled: true, isGenerating: false, processSegments: [a('p1')] }),
    ).toBe(false);
  });
});
