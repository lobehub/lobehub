import { BOT_CREDENTIAL_MASK } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { buildValidate } from './Body';

/** Discord's real bot-token pattern, the one a masked value has to survive. */
const tokenField = {
  key: 'botToken',
  label: 'botToken',
  pattern: '^[\\w-]{20,}\\.[\\w-]{5,}\\.[\\w-]{20,}$',
  type: 'password' as const,
};

const validate = (value: unknown) => {
  const validator = buildValidate(tokenField, (k: string) => k);
  if (!validator)
    throw new Error('buildValidate stopped emitting a validator for a patterned field');

  return validator(value);
};

describe('credential format rule', () => {
  it('accepts the placeholder a stored secret is read back as', () => {
    // Otherwise saving any unrelated edit on an existing channel would demand
    // the secret be retyped, because the form submits what the server gave it.
    expect(validate(BOT_CREDENTIAL_MASK)).toBeUndefined();
  });

  it('still accepts a real token', () => {
    expect(validate('MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.SUPERSECRETTOKENVALUE123')).toBeUndefined();
  });

  it('still rejects a malformed token', () => {
    expect(validate('nope')).toBe('botToken');
  });

  it('leaves an empty value to the required rule', () => {
    expect(validate('')).toBeUndefined();
  });
});
