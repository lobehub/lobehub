import { describe, expect, it } from 'vitest';

import { getToolError, toolErrorTitleKey } from './toolError';

describe('getToolError', () => {
  it('reads the error the runtime put in the state', () => {
    expect(
      getToolError(
        { error: { code: 'limit_reached', message: 'Topic has 10 subscriptions' } },
        undefined,
      ),
    ).toEqual({ code: 'limit_reached', message: 'Topic has 10 subscriptions' });
  });

  it('falls back to the plugin error when the state carries none', () => {
    expect(getToolError(undefined, { message: 'nope', type: 'forbidden' })).toEqual({
      code: 'forbidden',
      message: 'nope',
    });
  });

  it('reads an unrecognised code as unknown', () => {
    expect(getToolError({ error: { code: 'rate_limited' } }, undefined)).toEqual({
      code: 'unknown',
      message: undefined,
    });
    expect(getToolError(undefined, { type: 'PluginServerError' })?.code).toBe('unknown');
  });

  it('is undefined for a successful call', () => {
    expect(getToolError({ subscription: {} }, undefined)).toBeUndefined();
    expect(getToolError(undefined, undefined)).toBeUndefined();
  });
});

describe('toolErrorTitleKey', () => {
  it('names one key per code', () => {
    expect(toolErrorTitleKey('public_url_required')).toBe(
      'builtins.lobe-mcp-events.error.public_url_required',
    );
  });
});
