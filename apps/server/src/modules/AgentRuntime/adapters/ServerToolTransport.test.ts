import type { ToolRunContext } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';
import { beforeEach, expect, it, vi } from 'vitest';

import type { RuntimeExecutorContext } from '../context';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock('../dispatchClientTool', () => ({ dispatchClientTool: mocks.dispatch }));
vi.mock('@/server/services/deviceGateway/poolAccess', () => ({
  DevicePoolAccessService: vi.fn().mockImplementation(function () {
    return { isEnabled: mocks.isEnabled };
  }),
}));
vi.mock('../executorHelpers', () => ({
  TOOL_MAX_RETRIES: 0,
  TOOL_PRICING: {},
  GEN_AI_FUNCTION_TOOL_TYPE: 'function',
  log: vi.fn(),
}));

const { ServerToolTransport } = await import('./ServerToolTransport');

const payload: ChatToolPayload = {
  apiName: 'readLocalFile',
  arguments: '{}',
  executor: 'client',
  id: 'tool-1',
  identifier: 'lobe-local-system',
  type: 'builtin',
};
const runtime = {
  operationId: 'operation-1',
  serverDB: {},
  stepIndex: 0,
  streamManager: { sendToolExecute: vi.fn() },
  userId: 'user-1',
} as RuntimeExecutorContext;
const context = {
  callIndex: 0,
  effectiveManifestMap: {},
  mode: 'single',
  operationId: 'operation-1',
  parentMessageId: 'message-1',
  parsedArgs: {},
  state: { metadata: {} },
  stepIndex: 0,
  toolName: 'readLocalFile',
} as ToolRunContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue({ content: '', deferred: true, success: true });
});

/** @example Standalone Electron can execute local tools without a gateway device ID. */
it('preserves client tool dispatch with Labs disabled and no routed device', async () => {
  // ROOT CAUSE:
  //
  // The new pool guard required activeDeviceId even when Labs was disabled.
  // Standalone client execution has no gateway registration; the guard must
  // run only for persisted Labs participants, preserving the original transport.
  mocks.isEnabled.mockResolvedValue(false);
  const result = await new ServerToolTransport(runtime).run(payload, context);
  /** @example The existing client transport receives the tool and returns its deferred result. */
  expect(result.result).toMatchObject({ deferred: true, success: true });
  expect(mocks.dispatch).toHaveBeenCalledOnce();
});

/** @example Opting in never permits an unregistered client device to bypass pool policy. */
it('rejects an unrouted client device when Labs is enabled', async () => {
  mocks.isEnabled.mockResolvedValue(true);
  await expect(new ServerToolTransport(runtime).run(payload, context)).rejects.toThrow(
    'Device use is not permitted by its current policy',
  );
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
