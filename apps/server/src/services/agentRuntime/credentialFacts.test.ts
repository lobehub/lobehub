import { describe, expect, it } from 'vitest';

import { stepChangedCredentials } from './credentialFacts';

const result = (identifier: string, apiName: string) => [{ apiName, identifier }] as never;

describe('stepChangedCredentials', () => {
  it('is false for a step that ran no tools', () => {
    expect(stepChangedCredentials(undefined)).toBe(false);
    expect(stepChangedCredentials([] as never)).toBe(false);
  });

  it.each(['saveCreds', 'initiateOAuthConnect', 'connectComposioService'])(
    'is true after %s',
    (apiName) => {
      expect(stepChangedCredentials(result('lobe-creds', apiName))).toBe(true);
    },
  );

  it('is false for a creds call that only reads', () => {
    expect(stepChangedCredentials(result('lobe-creds', 'injectCredsToSandbox'))).toBe(false);
  });

  it('is false for another tool that happens to share an api name', () => {
    expect(stepChangedCredentials(result('lobe-web-browsing', 'saveCreds'))).toBe(false);
  });
});
