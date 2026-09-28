import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseCodexAccountIdentity } from './identity';

const base64url = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const jwt = (claims: Record<string, unknown>) =>
  `${base64url('{"alg":"none"}')}.${base64url(JSON.stringify(claims))}.sig`;

describe('parseCodexAccountIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes id_token claims without Node Buffer, as in the browser', () => {
    vi.stubGlobal('Buffer', undefined);

    const identity = parseCodexAccountIdentity(
      JSON.stringify({
        tokens: {
          account_id: 'acc_1',
          id_token: jwt({
            'email': '测试@example.com',
            'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' },
          }),
        },
      }),
    );

    expect(identity).toEqual({
      email: '测试@example.com',
      externalAccountId: 'acc_1',
      planTier: 'plus',
    });
  });

  it('returns null for unparsable input', () => {
    expect(parseCodexAccountIdentity('not json')).toBeNull();
  });
});
