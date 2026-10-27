import { describe, expect, it } from 'vitest';

import { toConnectorActionError } from './connectorActionError';

describe('toConnectorActionError', () => {
  it('keeps the tRPC code of a server rejection', () => {
    const error = Object.assign(new Error('Only the creator or a workspace owner can modify'), {
      data: { code: 'FORBIDDEN', httpStatus: 403 },
    });

    expect(toConnectorActionError('connect', error)).toEqual({
      action: 'connect',
      code: 'FORBIDDEN',
      message: 'Only the creator or a workspace owner can modify',
    });
  });

  it('treats a bare 403 as a permission rejection', () => {
    const error = Object.assign(new Error('Forbidden'), { data: { httpStatus: 403 } });

    expect(toConnectorActionError('remove', error).code).toBe('FORBIDDEN');
  });

  it('marks a request that never reached the server as a network failure', () => {
    expect(toConnectorActionError('remove', new TypeError('Failed to fetch')).code).toBe('NETWORK');
  });

  it('keeps the message of any other failure', () => {
    expect(toConnectorActionError('connect', new Error('Unsupported Composio app'))).toEqual({
      action: 'connect',
      code: undefined,
      message: 'Unsupported Composio app',
    });
  });
});
