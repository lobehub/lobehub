import { expect, it } from 'vitest';

import { assertToolDispatchPolicy } from './dispatchPolicy';

it('dispatches an opted-in auto tool in a custom tool set', () => {
  expect(() =>
    assertToolDispatchPolicy({
      identifier: 'custom',
      apiName: 'run',
      chatConfig: { toolMode: 'custom' },
      plugins: [{ identifier: 'custom', mode: 'auto' }],
    }),
  ).not.toThrow();
});

it('rejects a disabled tool after an earlier declaration and keeps chat mode authoritative', () => {
  expect(() =>
    assertToolDispatchPolicy({
      identifier: 'search',
      apiName: 'run',
      plugins: [{ identifier: 'search', mode: 'disabled' }],
      chatConfig: { enableAgentMode: true },
    }),
  ).toThrow();
  expect(() =>
    assertToolDispatchPolicy({
      identifier: 'lobe-local-system',
      apiName: 'runCommand',
      chatConfig: { enableAgentMode: true },
      conversationMode: 'chat',
    }),
  ).toThrow();
});
it('rejects an old device call when the topic has been rebound', () => {
  expect(() =>
    assertToolDispatchPolicy({
      identifier: 'lobe-local-system',
      apiName: 'runCommand',
      expectedDeviceId: 'old',
      currentDeviceId: 'new',
    }),
  ).toThrow(/device/i);
});
it('rejects a removed API and permits an eligible current API', () => {
  const manifest = {
    identifier: 'test',
    api: [{ name: 'current', description: '', parameters: {} }],
    type: 'builtin' as const,
  };
  expect(() => assertToolDispatchPolicy({ identifier: 'test', apiName: 'old', manifest })).toThrow(
    /API/i,
  );
  expect(() =>
    assertToolDispatchPolicy({ identifier: 'test', apiName: 'current', manifest }),
  ).not.toThrow();
});
