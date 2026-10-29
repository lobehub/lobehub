import { describe, expect, it } from 'vitest';

import { activityLabel } from './activityLabel';

describe('activityLabel', () => {
  it.each([
    ['3 位成员正在回复…', '3 位成员正在回复'],
    ['Alice and Bob are replying…', 'Alice and Bob are replying'],
    ['Alice · Replying...', 'Alice · Replying'],
    ['Agents receiving your message…', 'Agents receiving your message'],
    ['Alice · Preparing… ', 'Alice · Preparing'],
    ['Alice · Waiting for device approval', 'Alice · Waiting for device approval'],
    ['Agent... Smith · Replied', 'Agent... Smith · Replied'],
  ])('avoids duplicate typing dots in %s', (label, expected) => {
    expect(activityLabel(label)).toBe(expected);
  });
});
