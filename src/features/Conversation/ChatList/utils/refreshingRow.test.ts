import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveRefreshingRowId } from './refreshingRow';

const messages = (list: unknown[]) => list as UIChatMessage[];

describe('resolveRefreshingRowId', () => {
  it('targets the latest assistant reply', () => {
    const list = messages([
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'g2', role: 'assistantGroup' },
      { id: 'u3', role: 'user' },
    ]);

    expect(resolveRefreshingRowId(list, true)).toBe('g2');
  });

  const steered = messages([
    { content: 'first draft', id: 'a1', role: 'assistant' },
    { content: 'shorter please', id: 's1', metadata: { steer: true }, role: 'user' },
    { children: [{ content: 'final answer', id: 'b1' }], id: 'g2', role: 'assistantGroup' },
  ]);

  it('targets the host row when the list folds steer chains', () => {
    expect(resolveRefreshingRowId(steered, true)).toBe('a1');
  });

  it('targets the continuation itself in a flat custom-rendered list', () => {
    expect(resolveRefreshingRowId(steered, false)).toBe('g2');
  });

  it('targets nothing without an assistant reply', () => {
    expect(resolveRefreshingRowId(messages([{ id: 'u1', role: 'user' }]), true)).toBeUndefined();
  });
});
