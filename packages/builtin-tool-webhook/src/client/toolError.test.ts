import { describe, expect, it } from 'vitest';

import { canIssueKey, getToolError, toolErrorDetails, toolErrorTitleKey } from './toolError';

describe('webhook tool errors', () => {
  it('reads the failure from the state first, then from the error envelope', () => {
    expect(
      getToolError({ error: { code: 'forbidden', message: 'Only the creator' } }, undefined),
    ).toEqual({ code: 'forbidden', message: 'Only the creator' });
    expect(getToolError(undefined, { message: 'No such webhook', type: 'not_found' })).toEqual({
      code: 'not_found',
      message: 'No such webhook',
    });
    expect(getToolError({ webhooks: [] }, undefined)).toBeUndefined();
  });

  it('reads an unrecognised code as unknown', () => {
    expect(getToolError({ error: { code: 'ECONNRESET' } }, undefined)).toEqual({
      code: 'unknown',
      message: undefined,
    });
  });

  it('titles a failure by code and keeps the server words in the details', () => {
    expect(toolErrorTitleKey('not_in_channel')).toBe('builtins.lobe-webhook.error.not_in_channel');
    expect(toolErrorDetails({ code: 'bad_request', message: ' Nothing to change. ' })).toBe(
      'Nothing to change.\n(bad_request)',
    );
  });
});

describe('issuing a key from the card', () => {
  const generic = {
    canConfigure: true,
    endpoint: 'https://x/api/webhooks/inbound/1',
  } as const;

  it('is offered for a custom webhook the user configures', () => {
    expect(canIssueKey(generic)).toBe(true);
  });

  it('is not offered for rows of other creators or rows without a URL', () => {
    expect(canIssueKey({ ...generic, canConfigure: false })).toBe(false);
    expect(canIssueKey({ ...generic, endpoint: null })).toBe(false);
  });
});
