import { describe, expect, it } from 'vitest';

import { BOT_CREDENTIAL_MASK, isMaskedBotCredential } from './bot';

describe('isMaskedBotCredential', () => {
  it.each([
    [BOT_CREDENTIAL_MASK, true],
    [`  ${BOT_CREDENTIAL_MASK}  `, true],
    ['a-real-secret', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('%o → %s', (value, expected) => {
    expect(isMaskedBotCredential(value as string)).toBe(expected);
  });
});
