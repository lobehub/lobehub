import { describe, expect, it } from 'vitest';

import { isHiddenBackgroundRunLabel } from './BackgroundRunHintContext';

describe('isHiddenBackgroundRunLabel', () => {
  it('keeps the server-run copy by default', () => {
    expect(isHiddenBackgroundRunLabel('execServerAgentRuntime', true)).toBe(false);
  });

  it('hides the server-run copy when the surface opts out', () => {
    expect(isHiddenBackgroundRunLabel('execServerAgentRuntime', false)).toBe(true);
  });

  it('never hides other operation copy', () => {
    expect(isHiddenBackgroundRunLabel('sendMessage', false)).toBe(false);
    expect(isHiddenBackgroundRunLabel('execAgentRuntime', false)).toBe(false);
  });
});
