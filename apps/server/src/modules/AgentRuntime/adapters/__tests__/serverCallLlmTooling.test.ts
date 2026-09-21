import { type AgentState, normalizeAgentState } from '@lobechat/agent-runtime';
import { describe, expect, it } from 'vitest';

import { resolveServerCallLlmTooling } from '../serverCallLlmTooling';

const buildState = (
  state: Pick<
    AgentState,
    | 'binding'
    | 'operationToolSet'
    | 'plan'
    | 'principal'
    | 'toolExecutorMap'
    | 'toolManifestMap'
    | 'toolSourceMap'
    | 'tools'
  > = {},
): AgentState => state as AgentState;

const webBrowsing = {
  api: [{ description: 'Search the web', name: 'search', parameters: {} }],
  identifier: 'lobe-web-browsing',
  meta: { title: 'Web Browsing' },
  type: 'builtin',
} as unknown as NonNullable<AgentState['toolManifestMap']>[string];
const searchTool = {
  function: { name: 'lobe-web-browsing____search' },
  type: 'function',
} as unknown as NonNullable<AgentState['tools']>[number];

describe('resolveServerCallLlmTooling', () => {
  // Regression: `serverCallLlmContextBuilder` needs this to compute
  // `creds_sandbox_reachable` — `sandbox_enabled` alone (whether the
  // dedicated Cloud Sandbox tool is offered) doesn't tell it whether
  // `runCommand`/`execScript` will actually land in that sandbox or on a
  // routed device, so it must read the same single-track device gate the
  // rest of the run executors use.
  it('exposes the active device id when a device is routed for this run', () => {
    const result = resolveServerCallLlmTooling(
      { operationId: 'op-1', stepIndex: 0 },
      buildState({
        binding: { device: { id: 'device-1' } },
        plan: { execution: { deviceId: 'device-1', kind: 'device', target: 'device' } },
      }),
    );

    expect(result.activeDeviceId).toBe('device-1');
  });

  it('leaves the active device id undefined when no device is routed', () => {
    const result = resolveServerCallLlmTooling(
      { operationId: 'op-1', stepIndex: 0 },
      buildState({ plan: { execution: { kind: 'sandbox', target: 'sandbox' } } }),
    );

    expect(result.activeDeviceId).toBeUndefined();
  });

  // The state stores the tool set once, on the operation slot. This is the exit:
  // if the payload stops finding its tools here, the model loses them entirely.
  it('resolves the tools from the operation slot alone', () => {
    const result = resolveServerCallLlmTooling(
      { operationId: 'op-1', stepIndex: 0 },
      buildState({
        operationToolSet: {
          enabledToolIds: ['lobe-web-browsing'],
          executorMap: {},
          manifestMap: { 'lobe-web-browsing': webBrowsing },
          sourceMap: { 'lobe-web-browsing': 'builtin' },
          tools: [searchTool],
        },
      }),
    );

    expect(result.tools).toEqual([searchTool]);
    expect(result.resolved.enabledToolIds).toEqual(['lobe-web-browsing']);
  });

  // An operation that started before the slot existed keeps its tool set in the
  // legacy top-level mirrors; the load path lifts them and the payload is the same.
  it('still resolves the tools of a pre-slot operation', () => {
    const legacy = buildState({
      toolExecutorMap: {},
      toolManifestMap: { 'lobe-web-browsing': webBrowsing },
      toolSourceMap: { 'lobe-web-browsing': 'builtin' },
      tools: [searchTool],
    });

    expect(
      resolveServerCallLlmTooling({ operationId: 'op-1', stepIndex: 0 }, legacy).tools,
    ).toEqual([searchTool]);
    expect(
      resolveServerCallLlmTooling(
        { operationId: 'op-1', stepIndex: 0 },
        normalizeAgentState(legacy),
      ).tools,
    ).toEqual([searchTool]);
  });

  it('leaves the active device id undefined with no binding at all', () => {
    const result = resolveServerCallLlmTooling({ operationId: 'op-1', stepIndex: 0 }, buildState());

    expect(result.activeDeviceId).toBeUndefined();
  });
});
