import { describe, expect, it } from 'vitest';

import { stepChangedCredentials } from './credentialFacts';

const singleCall = (identifier: string, apiName: string) => ({
  payload: { toolCall: { apiName, identifier } },
  phase: 'tool_result',
});

const batch = (calls: { apiName: string; identifier: string }[]) => ({
  payload: { toolResults: calls.map((toolCall) => ({ toolCall })) },
  phase: 'tools_batch_result',
});

describe('stepChangedCredentials', () => {
  it('is false for a step that ran no tools', () => {
    expect(stepChangedCredentials(undefined)).toBe(false);
    expect(stepChangedCredentials({ payload: { message: 'hi' }, phase: 'user_input' })).toBe(false);
  });

  it.each(['saveCreds', 'initiateOAuthConnect', 'connectComposioService'])(
    'is true after %s',
    (apiName) => {
      expect(stepChangedCredentials(singleCall('lobe-creds', apiName))).toBe(true);
    },
  );

  it('is false for a creds call that only reads', () => {
    expect(stepChangedCredentials(singleCall('lobe-creds', 'injectCredsToSandbox'))).toBe(false);
  });

  it('is false for another tool that happens to share an api name', () => {
    expect(stepChangedCredentials(singleCall('lobe-web-browsing', 'saveCreds'))).toBe(false);
  });

  it.each(['lobe-agent', 'lobe-group-management'])(
    'is true after %s, because a nested run may have saved one',
    (identifier) => {
      expect(stepChangedCredentials(singleCall(identifier, 'anything'))).toBe(true);
    },
  );

  it('finds a mutating call anywhere in a batch', () => {
    expect(
      stepChangedCredentials(
        batch([
          { apiName: 'injectCredsToSandbox', identifier: 'lobe-creds' },
          { apiName: 'saveCreds', identifier: 'lobe-creds' },
        ]),
      ),
    ).toBe(true);

    expect(
      stepChangedCredentials(
        batch([{ apiName: 'injectCredsToSandbox', identifier: 'lobe-creds' }]),
      ),
    ).toBe(false);
  });
});
