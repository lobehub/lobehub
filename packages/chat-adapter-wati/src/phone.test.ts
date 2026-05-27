import { describe, expect, it } from 'vitest';

import { resolveWebhookPhoneNumber } from './phone';

describe('resolveWebhookPhoneNumber', () => {
  it('matches by digits and returns Wati display format', () => {
    const result = resolveWebhookPhoneNumber('85253332683', [
      { displayPhoneNumber: '852-5333-2683', phoneId: 'abc' },
    ]);
    expect(result).toBe('852-5333-2683');
  });

  it('uses the only number on the account when digits match loosely', () => {
    const result = resolveWebhookPhoneNumber('85253332683', [
      { displayPhoneNumber: '852-5333-2683' },
    ]);
    expect(result).toBe('852-5333-2683');
  });

  it('throws when multiple numbers and no match', () => {
    expect(() =>
      resolveWebhookPhoneNumber('999', [
        { displayPhoneNumber: '852-1111-1111' },
        { displayPhoneNumber: '852-2222-2222' },
      ]),
    ).toThrow(/No Wati WhatsApp number matches/);
  });
});
