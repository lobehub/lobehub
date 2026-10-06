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
    expect(result.content).toContain('Do not ask for the secret in the chat');
  });

  it('checks the scoped credential list after approval', async () => {
    const listCreds = vi.fn().mockResolvedValue({ data: [{ id: 1, key: 'openai' }] });
    const runtime = new CredsExecutionRuntime({ listCreds } as unknown as ICredsService);

    const result = await runtime.requestCredsInput(args);

    expect(listCreds).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
