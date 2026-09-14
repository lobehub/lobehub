import { describe, expect, it } from 'vitest';

import { PageAgentManifest } from './manifest';
import { DocumentApiName } from './types';

describe('PageAgentManifest collaborative rewrite contract', () => {
  it('declares rewriteSelection as a request/status bridge with no editor payload', () => {
    const api = PageAgentManifest.api.find(({ name }) => name === DocumentApiName.rewriteSelection);

    expect(api).toBeDefined();
    expect(api?.parameters).toMatchObject({
      additionalProperties: false,
      required: ['requestId'],
      type: 'object',
    });
    expect(api?.parameters.properties).toEqual({
      instruction: expect.objectContaining({ type: 'string', maxLength: 32768 }),
      requestId: expect.objectContaining({ type: 'string', minLength: 1, maxLength: 255 }),
    });
    expect(JSON.stringify(api?.parameters)).not.toContain('nodeKey');
    expect(JSON.stringify(api?.parameters)).not.toContain('roomTicket');
    expect(JSON.stringify(api?.parameters)).not.toContain('snapshot');
  });
});
