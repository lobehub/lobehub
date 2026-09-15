import { describe, expect, it } from 'vitest';

import { getDictationControlMode } from './presentation';

describe('getDictationControlMode', () => {
  it('reserves the active microphone presentation for live listening', () => {
    expect(getDictationControlMode('idle')).toBe('idle');
    expect(getDictationControlMode('requesting_permission')).toBe('busy');
    expect(getDictationControlMode('connecting')).toBe('busy');
    expect(getDictationControlMode('listening')).toBe('listening');
    expect(getDictationControlMode('finalizing')).toBe('busy');
    expect(getDictationControlMode('error')).toBe('error');
  });
});
