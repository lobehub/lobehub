import { describe, expect, it } from 'vitest';

import { createMcpEventError, getMcpEventErrorName, MCP_EVENT_ERROR_CODES } from './errors';

describe('MCP Events error classification', () => {
  it.each(Object.entries(MCP_EVENT_ERROR_CODES))(
    'recognizes %s by provisional number or symbolic name',
    (name, code) => {
      expect(getMcpEventErrorName({ code, message: 'server error' })).toBe(name);
      expect(getMcpEventErrorName({ cause: new Error(`${name}: failure`) })).toBe(name);
      expect(getMcpEventErrorName(createMcpEventError({ code, message: 'server error' }))).toBe(
        name,
      );
    },
  );
  it('prefers a symbolic error name when provisional numbers have changed', () => {
    expect(getMcpEventErrorName({ code: -32023, message: 'Forbidden: access revoked' })).toBe(
      'Forbidden',
    );
  });
  it('does not match incidental words and handles cause cycles', () => {
    expect(getMcpEventErrorName(new Error('NotFoundElsewhere'))).toBeUndefined();
    const error: { cause?: unknown } = {};
    error.cause = error;
    expect(getMcpEventErrorName(error)).toBeUndefined();
  });
});
