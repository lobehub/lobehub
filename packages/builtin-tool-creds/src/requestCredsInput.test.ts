import { describe, expect, it, vi } from 'vitest';

import { CredsExecutionRuntime, type ICredsService } from './ExecutionRuntime';
import { CredsManifest } from './manifest';
import { buildRequestCredsInputResult } from './requestCredsInput';
import { CredsApiName } from './types';

const args = {
  fieldNames: ['OPENAI_API_KEY'],
  key: 'openai',
  name: 'OpenAI API Key',
  type: 'kv-env' as const,
};

describe('requestCredsInput', () => {
  it('declares only non-secret parameters and always pauses for the user', () => {
    const api = CredsManifest.api.find((item) => item.name === CredsApiName.requestCredsInput);

    expect(api?.humanIntervention).toBe('always');
    expect(api?.parameters).toMatchObject({ additionalProperties: false });
    expect(Object.keys((api?.parameters as { properties: object }).properties).sort()).toEqual([
      'description',
      'fieldNames',
      'key',
      'name',
      'type',
    ]);
  });

  it('no longer offers an API that takes credential values as arguments', () => {
    expect(CredsManifest.api.map((item) => item.name)).not.toContain('saveCreds');
    for (const api of CredsManifest.api) {
      expect(
        Object.keys((api.parameters as { properties?: object }).properties ?? {}),
      ).not.toContain('values');
    }
  });

  it('reports a saved credential by key only', () => {
    const result = buildRequestCredsInputResult(args, true);

    expect(result.success).toBe(true);
    expect(result.state).toEqual({ key: 'openai' });
    expect(result.content).toContain('"openai"');
  });

  it('fails without asking for the secret when the form was not completed', () => {
    const result = buildRequestCredsInputResult(args, false);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('CredentialNotFound');
    // T-675: the old copy ended with "Call requestCredsInput again only if
    // the user asks to", which a diligent agent followed into a 4-attempt
    // dead loop. The new copy must forbid the retry explicitly.
    expect(result.content).toContain('Do NOT call requestCredsInput again');
    expect(result.content).not.toContain('Call requestCredsInput again only if');
  });

  it('checks the scoped credential list after approval', async () => {
    const listCreds = vi.fn().mockResolvedValue({ data: [{ id: 1, key: 'openai' }] });
    const runtime = new CredsExecutionRuntime({ listCreds } as unknown as ICredsService);

    const result = await runtime.requestCredsInput(args);

    expect(listCreds).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});

describe('requestCredsInput — T-675 form-bypass guidance', () => {
  it('does NOT invite a blind retry when the form was bypassed', () => {
    const result = buildRequestCredsInputResult(args, false);

    expect(result.content).toMatch(/will fail the same way|Do NOT call requestCredsInput again/);
    expect(result.content).not.toContain('Call requestCredsInput again');
  });

  it('names the key and offers the manual settings path', () => {
    const result = buildRequestCredsInputResult(args, false);

    expect(result.content).toContain('"openai"');
    expect(result.content).toContain('Settings → Credentials');
  });

  it('keeps the CredentialNotFound error contract for replan routing', () => {
    const result = buildRequestCredsInputResult(args, false);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('CredentialNotFound');
    expect(result.error?.message).toBe('Credential not found: openai');
  });

  it('renders the credential name in the manual path when provided', () => {
    const result = buildRequestCredsInputResult({ key: 'gitlab-selfhosted', name: 'Self-hosted GitLab PAT' }, false);

    expect(result.content).toContain('("Self-hosted GitLab PAT")');
  });
});
