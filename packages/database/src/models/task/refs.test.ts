import type { TaskItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { matchTaskRefs, parseTaskRef } from './refs';

const task = (id: string, identifier: string) => ({ id, identifier }) as TaskItem;

describe('task ref classification and matching', () => {
  it('trims and preserves case-sensitive ids, uppercasing aliases only', () => {
    expect(parseTaskRef(' task_AbC ')).toEqual({
      kind: 'id',
      raw: ' task_AbC ',
      value: 'task_AbC',
    });
    expect(parseTaskRef(' abc-3 ')).toEqual({ kind: 'identifier', raw: ' abc-3 ', value: 'ABC-3' });
    expect(parseTaskRef('TASK_AbC').kind).toBe('identifier');
    expect(parseTaskRef(' ').value).toBe('');
  });
  it('never crosses buckets and returns ambiguous refs rather than an arbitrary match', () => {
    const rows = [task('task_AbC', 'T-1'), task('task_B', 'T-1'), task('task_C', 'TASK_MISSING')];
    const result = matchTaskRefs(
      ['T-1', 'task_missing', 'task_AbC', ' task_AbC ', 'nonsense'].map(parseTaskRef),
      rows,
    );
    expect(result.ambiguous).toEqual(['T-1']);
    expect(result.missing).toEqual(['task_missing', 'nonsense']);
    expect(result.tasks.map((t) => t.id)).toEqual(['task_AbC']);
    expect(result.byRef.get(' task_AbC ')?.id).toBe('task_AbC');
  });
});
