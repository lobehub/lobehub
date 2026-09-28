import { BOT_CREDENTIAL_MASK } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { buildRules } from './Body';

/** Discord's real bot-token pattern, the one a masked value has to survive. */
const tokenField = {
  key: 'botToken',
  label: 'botToken',
  pattern: '^[\\w-]{20,}\\.[\\w-]{5,}\\.[\\w-]{20,}$',
  type: 'password' as const,
};

type FormRule = { validator?: (rule: unknown, value: unknown) => Promise<void> };

const validate = (value: unknown) => {
  const rules = buildRules(tokenField, (k: string) => k) as FormRule[];
  const validator = rules.find((rule) => rule.validator)?.validator;
  if (!validator) throw new Error('buildRules stopped emitting a validator for a patterned field');

  return validator(undefined, value);
};

describe('credential format rule', () => {
  it('accepts the placeholder a stored secret is read back as', async () => {
    // Otherwise saving any unrelated edit on an existing channel would demand
    // the secret be retyped, because the form submits what the server gave it.
    await expect(validate(BOT_CREDENTIAL_MASK)).resolves.toBeUndefined();
  });

  it('still accepts a real token', async () => {
    await expect(
      validate('MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.SUPERSECRETTOKENVALUE123'),
    ).resolves.toBeUndefined();
  });

  it('still rejects a malformed token', async () => {
    await expect(validate('nope')).rejects.toThrow();
  });

  it('leaves an empty value to the required rule', async () => {
    await expect(validate('')).resolves.toBeUndefined();
  });
});
