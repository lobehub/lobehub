import { describe, expect, it } from 'vitest';

import { mobileRouter } from './index';

describe('mobileRouter', () => {
  it('exposes speech transcription', () => {
    const caller = mobileRouter.createCaller({} as never);

    expect(caller.asr.transcribe).toBeTypeOf('function');
  });
});
