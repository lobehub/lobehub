import { describe, expect, it, vi } from 'vitest';

import { CredsExecutionRuntime, type ICredsService } from './ExecutionRuntime';
import { CredsManifest } from './manifest';
import {
  buildRequestCredsInputCheckFailure,
  buildRequestCredsInputResult,
  RequestCredsInputErrorCode,
} from './requestCredsInput';
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
    expect(result.state).toEqual({ key: 'openai', status: 'saved' });
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

describe('requestCredsInput — diagnosable outcomes (T-14098)', () => {
  it('returns the request id with a saved credential', () => {
    const result = buildRequestCredsInputResult(args, true, { requestId: 'call_creds_1' });

    expect(result.success).toBe(true);
    expect(result.state).toEqual({ key: 'openai', requestId: 'call_creds_1', status: 'saved' });
    expect(result.content).toContain('Request ID: call_creds_1');
  });

  it('gives an unsaved credential a machine-readable code and status', () => {
    const result = buildRequestCredsInputResult(args, false, { requestId: 'call_creds_1' });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: RequestCredsInputErrorCode.NotSaved,
      type: 'CredentialNotFound',
    });
    expect(result.state).toEqual({ key: 'openai', requestId: 'call_creds_1', status: 'not_saved' });
  });

  it('passes the tool call id through the server runtime as the request id', async () => {
    const listCreds = vi.fn().mockResolvedValue({ data: [{ id: 1, key: 'openai' }] });
    const runtime = new CredsExecutionRuntime({ listCreds } as unknown as ICredsService);

    const result = await runtime.requestCredsInput(args, { toolCallId: 'call_creds_2' });

    expect(result.state).toMatchObject({ requestId: 'call_creds_2', status: 'saved' });
  });

  it('keeps an upstream block reason instead of a bare "Request blocked"', async () => {
    // The exact payload the LobeHub gateway throws for an account that has not
    // finished onboarding.
    const listCreds = vi.fn().mockRejectedValue({
      _responseBody: { provider: 'lobehub', reason: 'not_onboarded' },
      error: { message: 403 },
      errorType: 403,
      message: 'Request blocked.',
      provider: 'lobehub',
    });
    const runtime = new CredsExecutionRuntime({ listCreds } as unknown as ICredsService);

    const result = await runtime.requestCredsInput(args, { toolCallId: 'call_creds_3' });

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: RequestCredsInputErrorCode.AccessDenied,
      httpStatus: 403,
      message: 'Request blocked.',
      reason: 'not_onboarded',
    });
    // Client persistence keeps only body/message/type, so the diagnostics must
    // also live in the body.
    expect(result.error?.body).toEqual({
      code: RequestCredsInputErrorCode.AccessDenied,
      httpStatus: 403,
      reason: 'not_onboarded',
    });
    expect(result.state).toEqual({
      key: 'openai',
      requestId: 'call_creds_3',
      status: 'unconfirmed',
    });
    expect(result.content).toContain('reason: not_onboarded');
    expect(result.content).toContain('HTTP 403');
    expect(result.content).toContain('Request ID: call_creds_3');
  });

  it('classifies a tRPC FORBIDDEN as an access refusal', () => {
    const result = buildRequestCredsInputCheckFailure(args, {
      data: { code: 'FORBIDDEN', httpStatus: 403 },
      message: 'FORBIDDEN',
    });

    expect(result.error).toMatchObject({
      code: RequestCredsInputErrorCode.AccessDenied,
      httpStatus: 403,
    });
  });

  it('reports any other lookup failure as unconfirmed, never as an empty result', () => {
    const result = buildRequestCredsInputCheckFailure(args, new Error('socket hang up'));

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({
      code: RequestCredsInputErrorCode.CheckFailed,
      message: 'socket hang up',
      type: 'CheckCredentialFailed',
    });
    expect(result.error).not.toHaveProperty('httpStatus');
    expect(result.error?.body).toEqual({ code: RequestCredsInputErrorCode.CheckFailed });
    expect(result.content).toContain(RequestCredsInputErrorCode.CheckFailed);
    expect(result.content.trim()).not.toBe('');
  });
});
