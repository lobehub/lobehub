import { describe, expect, it } from 'vitest';

import type { ProjectDirectory } from '@/store/projectWorkingDirectory';

import { orderExecutionEnvironments, pickExecutionEnvironment } from './executionEnvironments';

const folder = (id: string, sortOrder = 0) => ({ id, sortOrder }) as unknown as ProjectDirectory;
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('orderExecutionEnvironments', () => {
  it('puts folders before the sandbox until anything is reordered', () => {
    expect(ids(orderExecutionEnvironments([folder('a'), folder('b')]))).toEqual([
      'a',
      'b',
      'sandbox',
    ]);
  });

  it('follows the stored order of folders and the sandbox', () => {
    expect(ids(orderExecutionEnvironments([folder('a', 2), folder('b', 1)], 0))).toEqual([
      'sandbox',
      'b',
      'a',
    ]);
  });

  it('is only the sandbox for a project without folders', () => {
    expect(ids(orderExecutionEnvironments([]))).toEqual(['sandbox']);
  });
});

describe('pickExecutionEnvironment', () => {
  const ordered = orderExecutionEnvironments([folder('a', 0), folder('b', 1)], 2);

  it('picks the first folder that is available now', () => {
    expect(pickExecutionEnvironment(ordered, (d) => d.id === 'b').id).toBe('b');
  });

  it('falls back to the sandbox when no folder is available', () => {
    expect(pickExecutionEnvironment(ordered, () => false).id).toBe('sandbox');
  });

  it('never picks a folder placed after the sandbox', () => {
    const sandboxFirst = orderExecutionEnvironments([folder('a', 1)], 0);
    expect(pickExecutionEnvironment(sandboxFirst, () => true).id).toBe('sandbox');
  });
});
