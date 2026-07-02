import { describe, expect, it } from 'vitest';

import { LOADING_FLAT } from '@/const/message';

import {
  countFoldedProcessSteps,
  hasRenderableFinalAnswer,
  shouldFoldProcess,
  splitFinalAnswer,
} from './segments';

const a = (id: string, content = 'answer') => ({
  block: { content, id } as any,
  kind: 'answer' as const,
});
const tools = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `tool-${index}` }) as any);
const w = (id: string, toolCount = 0) => ({
  blocks: [{ id, tools: toolCount > 0 ? tools(toolCount) : undefined } as any],
  kind: 'workflow' as const,
});

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

describe('countFoldedProcessSteps', () => {
  it('counts folded assistant blocks and tool calls', () => {
    const segments = [w('b1', 2), a('b2'), w('b3', 1)];

    expect(countFoldedProcessSteps(segments)).toBe(6);
  });

  it('does not double-count a mixed block split into answer and workflow segments', () => {
    const segments = [
      a('mixed-block'),
      w('mixed-block', 2),
      w('next-block', 1),
    ];

    expect(countFoldedProcessSteps(segments)).toBe(5);
  });
});

describe('hasRenderableFinalAnswer', () => {
  it('ignores empty settled answer placeholders', () => {
    expect(hasRenderableFinalAnswer([a('empty', '')])).toBe(false);
    expect(hasRenderableFinalAnswer([a('loading', LOADING_FLAT)])).toBe(false);
  });

  it('detects an answer segment that will render visible content', () => {
    expect(hasRenderableFinalAnswer([w('t1'), a('final', 'Done.')])).toBe(true);
    expect(
      hasRenderableFinalAnswer([
        {
          block: { content: '', error: { message: 'failed' }, id: 'error-answer' } as any,
          kind: 'answer',
        },
      ]),
    ).toBe(true);
  });
});

describe('shouldFoldProcess', () => {
  const proc = [w('t1')];

  it('folds a finished, non-latest turn that has a workflow when enabled', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        isGenerating: false,
        operationEnded: true,
        processSegments: proc,
      }),
    ).toBe(true);
  });

  it('never folds when the lab flag is disabled', () => {
    expect(
      shouldFoldProcess({
        enabled: false,
        isGenerating: false,
        operationEnded: true,
        processSegments: proc,
      }),
    ).toBe(false);
    expect(
      shouldFoldProcess({ isGenerating: false, operationEnded: true, processSegments: proc }),
    ).toBe(false);
  });

  it('never folds before the operation has ended', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        hasFinalAnswer: true,
        isGenerating: false,
        isLatestItem: true,
        operationEnded: false,
        processSegments: proc,
      }),
    ).toBe(false);
  });

  it('folds a finished latest turn once a final answer is visible', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        hasFinalAnswer: true,
        isGenerating: false,
        isLatestItem: true,
        operationEnded: true,
        processSegments: proc,
      }),
    ).toBe(true);
  });

  it('keeps a latest tool-only turn expanded when no final answer is visible', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        hasFinalAnswer: false,
        isGenerating: false,
        isLatestItem: true,
        operationEnded: true,
        processSegments: proc,
      }),
    ).toBe(false);
  });

  it('never folds while generating', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        isGenerating: true,
        operationEnded: true,
        processSegments: proc,
      }),
    ).toBe(false);
  });

  it('does not fold when the process has no workflow (e.g. pure prose)', () => {
    expect(
      shouldFoldProcess({
        enabled: true,
        isGenerating: false,
        operationEnded: true,
        processSegments: [a('p1')],
      }),
    ).toBe(false);
  });
});
