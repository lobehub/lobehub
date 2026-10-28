import { expect, it } from 'vitest';

import { buildPluginMcpParams } from './pluginParams';

it('preserves installed HTTP identity and manual headers, with settings overriding configured fields', () => {
  expect(
    buildPluginMcpParams({
      identifier: 'installed',
      customParams: {
        mcp: {
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { Authorization: 'fixture-original', tenant: 'one' },
        },
      },
      settings: { Authorization: 'fixture-current', absent: null },
    }),
  ).toEqual({
    name: 'installed',
    type: 'http',
    url: 'https://example.test/mcp',
    headers: { Authorization: 'fixture-current', tenant: 'one' },
  });
});
it('preserves custom stdio command/args and binds its merged environment on both initial and resumed execution', () => {
  expect(
    buildPluginMcpParams({
      identifier: 'custom',
      customParams: {
        mcp: { type: 'stdio', command: 'fixture', args: ['--stdio'], env: { TENANT: 'first' } },
      },
      settings: { TENANT: 'current', OPTIONAL: undefined },
    }),
  ).toEqual({
    name: 'custom',
    type: 'stdio',
    command: 'fixture',
    args: ['--stdio'],
    env: { TENANT: 'current' },
  });
});
