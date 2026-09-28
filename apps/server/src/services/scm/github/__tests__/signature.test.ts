import { describe, expect, it } from 'vitest';

import { signGitHubPayload, verifyGitHubSignature } from '../signature';

const secret = "It's a Secret to Everybody";
const body = 'Hello, World!';

describe('verifyGitHubSignature', () => {
  it('accepts the signature GitHub documents for the reference secret and body', () => {
    // From https://docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries
    const documented = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
    expect(signGitHubPayload(body, secret)).toBe(documented);
    expect(verifyGitHubSignature({ rawBody: body, secret, signature: documented })).toBe(true);
  });

  it('rejects a missing, malformed, or wrong signature', () => {
    expect(verifyGitHubSignature({ rawBody: body, secret, signature: undefined })).toBe(false);
    expect(verifyGitHubSignature({ rawBody: body, secret, signature: 'sha1=abc' })).toBe(false);
    expect(verifyGitHubSignature({ rawBody: body, secret, signature: 'sha256=00' })).toBe(false);
    expect(
      verifyGitHubSignature({
        rawBody: `${body} `,
        secret,
        signature: signGitHubPayload(body, secret),
      }),
    ).toBe(false);
    expect(
      verifyGitHubSignature({
        rawBody: body,
        secret: 'other',
        signature: signGitHubPayload(body, secret),
      }),
    ).toBe(false);
  });
});
