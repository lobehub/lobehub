import { describe, expect, it } from 'vitest';

import { isBetterScore, parseEvaluatorOutput } from './goalObjective';

describe('parseEvaluatorOutput', () => {
  it('reads the last JSON result, with validity, summary and numeric metrics', () => {
    const output = [
      '{"progress": 0.5}',
      'scoring...',
      '{"score": 37.539, "valid": true, "summary": "ok", "metrics": {"M1": 0.78, "note": "x"}}',
    ].join('\n');

    expect(parseEvaluatorOutput(output)).toEqual({
      metrics: { M1: 0.78 },
      score: 37.539,
      summary: 'ok',
      valid: true,
    });
  });

  it('keeps an unrankable JSON result as invalid rather than dropping it', () => {
    expect(parseEvaluatorOutput('{"score": 0, "valid": false, "summary": "crashed"}')).toEqual({
      score: 0,
      summary: 'crashed',
      valid: false,
    });
  });

  it('falls back to TOTAL_SCORE, then a score line, then a bare last number', () => {
    expect(parseEvaluatorOutput('TOTAL_SCORE 10\nlog\nTOTAL_SCORE 12.5\n')?.score).toBe(12.5);
    expect(parseEvaluatorOutput('training done\nScore: -3.25')?.score).toBe(-3.25);
    expect(parseEvaluatorOutput('running\n0.91\n')?.score).toBe(0.91);
  });

  it('finds nothing in output without a score', () => {
    expect(parseEvaluatorOutput('Traceback (most recent call last):\n  oops')).toBeUndefined();
    expect(parseEvaluatorOutput('{"valid": true}')).toBeUndefined();
    expect(parseEvaluatorOutput('')).toBeUndefined();
  });
});

describe('isBetterScore', () => {
  it('follows the direction', () => {
    expect(isBetterScore('max', 2, 1)).toBe(true);
    expect(isBetterScore('min', 2, 1)).toBe(false);
    expect(isBetterScore('min', 1, 1)).toBe(false);
  });
});
