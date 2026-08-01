import { describe, expect, it } from 'vitest';

import { SmsImplType, SmsService } from './index';

describe('SmsService module imports', () => {
  it('exports runtime values without import-type parse errors', () => {
    expect(SmsImplType.Debug).toBe('debug');
    expect(SmsImplType.Kavenegar).toBe('kavenegar');
    expect(typeof SmsService).toBe('function');
    expect(new SmsService(SmsImplType.Debug)).toBeInstanceOf(SmsService);
  });
});
