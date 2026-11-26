import type { ElicitRequestFormParams } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';

import {
  getMcpFormDefaults,
  getMcpFormOptions,
  validateMcpElicitationRequest,
  validateMcpElicitationResponse,
} from './form';

const request: ElicitRequestFormParams = {
  mode: 'form',
  message: 'Project settings',
  requestedSchema: {
    type: 'object',
    required: ['name', 'count', 'enabled', 'choices', 'email'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 8, default: 'demo' },
      count: { type: 'integer', minimum: 1, maximum: 5, default: 2 },
      score: { type: 'number', minimum: 0, maximum: 1 },
      enabled: { type: 'boolean' },
      email: { type: 'string', format: 'email', default: 'test@example.com' },
      day: { type: 'string', format: 'date' },
      timestamp: { type: 'string', format: 'date-time' },
      uri: { type: 'string', format: 'uri' },
      choice: {
        type: 'string',
        oneOf: [
          { const: 'a', title: 'Alpha' },
          { const: 'b', title: 'Beta' },
        ],
      },
      choices: {
        type: 'array',
        minItems: 1,
        maxItems: 2,
        items: { type: 'string', enum: ['a', 'b', 'c'] },
        default: ['a'],
      },
    },
  },
};
const valid = () => ({ ...getMcpFormDefaults(request), enabled: false });

describe('official elicitation form subset', () => {
  it('retains explicit defaults and includes a required unchecked boolean', () => {
    expect(valid()).toEqual({
      name: 'demo',
      count: 2,
      enabled: false,
      email: 'test@example.com',
      choices: ['a'],
    });
    expect(validateMcpElicitationResponse(request, { action: 'accept', content: valid() })).toEqual(
      [],
    );
  });
  it.each([
    { name: 'a' },
    { name: '123456789' },
    { count: 0 },
    { count: 6 },
    { count: 1.5 },
    { enabled: 'false' },
    { email: 'wrong' },
    { choices: [] },
    { choices: ['a', 'b', 'c'] },
    { choices: ['outside'] },
    { score: -1 },
    { day: '2026-99-99' },
    { timestamp: 'tomorrow' },
    { uri: 'not a uri' },
    { extra: 'not requested' },
  ])('rejects invalid values without coercion: %j', (patch) => {
    expect(
      validateMcpElicitationResponse(request, {
        action: 'accept',
        content: { ...valid(), ...patch },
      }),
    ).not.toEqual([]);
  });
  it.each(['decline', 'cancel'] as const)('supports %s without collecting content', (action) => {
    expect(validateMcpElicitationResponse(request, { action })).toEqual([]);
    expect(validateMcpElicitationResponse(request, { action, content: valid() })).not.toEqual([]);
  });
  it('preserves enum values separately from display labels for both enum generations', () => {
    expect(
      getMcpFormOptions({ type: 'string', enum: ['red', 'blue'], enumNames: ['Red', 'Blue'] }),
    ).toEqual([
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ]);
    expect(getMcpFormOptions(request.requestedSchema.properties.choice)).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ]);
    expect(
      getMcpFormOptions({ type: 'array', items: { anyOf: [{ const: 'one', title: 'One' }] } }),
    ).toEqual([{ value: 'one', label: 'One' }]);
  });
  it.each(['password', 'api_key', 'client_secret'])(
    'rejects secret collection through %s',
    (name) => {
      expect(() =>
        validateMcpElicitationRequest({
          ...request,
          requestedSchema: { type: 'object', properties: { [name]: { type: 'string' } } },
        }),
      ).toThrow('Secrets');
    },
  );
});

describe('URL elicitation trust boundary', () => {
  it.each(['https://example.com/complete?request=1', 'http://localhost:4000/complete'])(
    'accepts %s without fetching it',
    (url) => {
      const input = { mode: 'url' as const, message: 'Complete setup', url };
      expect(() => validateMcpElicitationRequest(input)).not.toThrow();
      expect(validateMcpElicitationResponse(input, { action: 'accept' })).toEqual([]);
      expect(
        validateMcpElicitationResponse(input, { action: 'accept', content: { secret: 'no' } }),
      ).not.toEqual([]);
    },
  );
  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://example.com/',
    'https://user:pass@example.com',
  ])('rejects unsafe target %s', (url) => {
    expect(() => validateMcpElicitationRequest({ mode: 'url', message: 'Setup', url })).toThrow();
  });
});

it('preserves required false/zero/empty defaults and optional absence as distinct values', () => {
  const input = {
    mode: 'form' as const,
    message: 'Falsy values',
    requestedSchema: {
      type: 'object' as const,
      required: ['flag', 'amount', 'text'],
      properties: {
        flag: { type: 'boolean' as const },
        amount: { type: 'number' as const, default: 0 },
        text: { type: 'string' as const, minLength: 0 },
        optional: { type: 'string' as const },
      },
    },
  };
  const defaults = getMcpFormDefaults(input);
  expect(defaults).toEqual({ flag: false, amount: 0, text: '' });
  expect(validateMcpElicitationResponse(input, { action: 'accept', content: defaults })).toEqual(
    [],
  );
});
