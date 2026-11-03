import { describe, expect, it } from 'vitest';

import { BRANDING_EMAIL } from './branding';

describe('BRANDING_EMAIL', () => {
  it('leaves Reply-To unset by default for self-hosted deployments', () => {
    expect(BRANDING_EMAIL.replyTo).toBeUndefined();
  });
});
