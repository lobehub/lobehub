import { describe, expect, it } from 'vitest';

import { parseTriggerParam } from './urlState';

describe('parseTriggerParam', () => {
  it('accepts a known source', () => {
    expect(parseTriggerParam('share')).toBe('share');
    expect(parseTriggerParam('chat')).toBe('chat');
  });

  it('ignores a missing or unknown source', () => {
    expect(parseTriggerParam(null)).toBeUndefined();
    expect(parseTriggerParam('')).toBeUndefined();
    expect(parseTriggerParam('visitor')).toBeUndefined();
  });
});
