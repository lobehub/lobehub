import { describe, expect, it } from 'vitest';

import { CreateAgentAccountRequestSchema } from './agent-account.type';

describe('CreateAgentAccountRequestSchema', () => {
  it('accepts a complete mount and a bare provision request', () => {
    expect(
      CreateAgentAccountRequestSchema.safeParse({
        identifier: 'agent@github',
        kind: 'service',
        provider: 'user',
      }).success,
    ).toBe(true);
    expect(CreateAgentAccountRequestSchema.safeParse({ provider: 'agent-mail' }).success).toBe(
      true,
    );
  });

  it('rejects a mount missing `kind` instead of reading it as a provision request', () => {
    // Falling through to the provision branch would strip `identifier` and ask
    // the provider to issue a brand-new identity the caller never asked for.
    expect(
      CreateAgentAccountRequestSchema.safeParse({
        identifier: 'agent@lobe.id',
        provider: 'agent-mail',
      }).success,
    ).toBe(false);
  });

  it('rejects a mount whose capabilities are invalid', () => {
    expect(
      CreateAgentAccountRequestSchema.safeParse({
        capabilities: { receive: 'yes' },
        identifier: 'agent@lobe.id',
        kind: 'mail',
        provider: 'agent-mail',
      }).success,
    ).toBe(false);
  });
});
