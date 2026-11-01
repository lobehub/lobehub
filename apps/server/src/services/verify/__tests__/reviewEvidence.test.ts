// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  allocateEvidenceBudget,
  formatTextEvidence,
  TEXT_EVIDENCE_BUDGET,
} from '../reviewEvidence';

const row = (id: string, length: number, description?: string) => ({
  content: id.repeat(length).slice(0, length),
  description,
  id,
  type: 'text',
});

/**
 * Regression: first-fit over capture order let one attachment starve the rest.
 *
 * The real case was a Goal delivery whose reproducibility check carried four
 * rows — 31,853 chars of script source, a 4,307-char rerun log, a 52,226-char
 * score dump and a 1,319-char summary. Spending the budget in arrival order
 * consumed it before the summary, which was dropped silently, and the reviewer
 * rejected the check for evidence that had in fact been attached.
 */
describe('allocateEvidenceBudget', () => {
  it('keeps a small row whole when an earlier large row could have eaten the budget', () => {
    const rows = [
      row('scripts', 31_853),
      row('log', 4307),
      row('scores', 52_226),
      row('sum', 1319),
    ];
    const allowances = allocateEvidenceBudget(rows, TEXT_EVIDENCE_BUDGET);

    expect(allowances.get('sum')).toBe(1319);
    expect(allowances.get('log')).toBe(4307);
    // The two oversized rows share what is left instead of claiming it in order.
    expect(allowances.get('scripts')).toBeLessThan(31_853);
    expect(allowances.get('scores')).toBeLessThan(52_226);
  });

  it('never hands out more than the budget', () => {
    const rows = [row('a', 40_000), row('b', 40_000), row('c', 40_000)];
    const total = [...allocateEvidenceBudget(rows, TEXT_EVIDENCE_BUDGET).values()].reduce(
      (sum, take) => sum + take,
      0,
    );
    expect(total).toBeLessThanOrEqual(TEXT_EVIDENCE_BUDGET);
  });

  it('gives every row at least an equal share when all of them are oversized', () => {
    const rows = [row('a', 40_000), row('b', 40_000), row('c', 40_000)];
    const allowances = allocateEvidenceBudget(rows, 30_000);
    rows.forEach(({ id }) => expect(allowances.get(id)).toBe(10_000));
  });

  it('releases the remainder of small rows to the large ones', () => {
    const allowances = allocateEvidenceBudget([row('small', 10), row('big', 10_000)], 1000);
    expect(allowances.get('small')).toBe(10);
    expect(allowances.get('big')).toBe(990);
  });
});

describe('formatTextEvidence', () => {
  it('keeps capture order and labels each row with its type and caption', () => {
    const block = formatTextEvidence([
      {
        content: 'first payload',
        description: 'rerun log: all five commands exited 0',
        id: 'e1',
        type: 'text',
      },
      { content: 'second payload', description: null, id: 'e2', type: 'markdown' },
    ]);

    expect(block.indexOf('e1')).toBeLessThan(block.indexOf('e2'));
    expect(block).toContain('[Evidence e1 · text] rerun log: all five commands exited 0');
    expect(block).toContain('[Evidence e2 · markdown]');
    expect(block).toContain('first payload');
  });

  it('says a row was truncated instead of letting it stop mid-payload', () => {
    const block = formatTextEvidence([row('a', 100), row('b', 100)], 100);
    expect(block).toContain('(truncated: first 50 of 100 characters)');
  });

  it('names a row it could not fit rather than dropping it silently', () => {
    const block = formatTextEvidence([row('a', 10), row('b', 10)], 1);
    expect(block).toContain('[Evidence b · text]');
    expect(block).toContain('did not fit the evidence budget');
  });

  it('returns nothing when there is no readable evidence', () => {
    expect(formatTextEvidence([])).toBe('');
  });
});
