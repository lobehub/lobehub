import { expect, it } from 'vitest';

import { devicePoolRuleSchema } from './devicePool';

/** @example Self-hosted identity providers can use punctuation in opaque user IDs. */
it('accepts opaque user IDs without narrowing the user creation contract', () => {
  // ROOT CAUSE:
  // The user:[\w-]+ validator excluded IDs accepted by CreateUserRequestSchema.
  // A subject must preserve the opaque user ID after its user: prefix.
  const rules = {
    'user:auth0|abc': 'deny',
    'user:tenant.example/alice': 'allow',
  };
  /** @example Both subjects survive policy validation unchanged. */
  expect(devicePoolRuleSchema.parse(rules)).toEqual(rules);
});

/** @example An empty ID and unrecognized identity groups are still invalid. */
it('rejects empty user IDs and unknown built-in subjects', () => {
  /** @example The user: prefix alone cannot identify a person. */
  expect(devicePoolRuleSchema.safeParse({ 'user:': 'allow' }).success).toBe(false);
  /** @example Future roles must be introduced explicitly. */
  expect(devicePoolRuleSchema.safeParse({ admin: 'allow' }).success).toBe(false);
});
