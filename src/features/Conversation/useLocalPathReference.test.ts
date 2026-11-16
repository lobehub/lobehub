import { describe, expect, it } from 'vitest';

import { canReadLocalFileReferences, canRuntimeReachLocalMachine } from './useLocalPathReference';

const base = {
  isHeterogeneous: false,
  isLocalSystemEnabled: true,
  pinnedPluginIds: [] as string[],
  toolMode: 'agent' as const,
};

describe('canReadLocalFileReferences', () => {
  it('allows local references in agent mode with local system enabled', () => {
    expect(canReadLocalFileReferences(base)).toBe(true);
  });

  it('keeps uploading in chat mode, which never offers lobe-local-system', () => {
    expect(canReadLocalFileReferences({ ...base, toolMode: 'chat' })).toBe(false);
  });

  it('allows custom mode only when lobe-local-system is pinned', () => {
    expect(canReadLocalFileReferences({ ...base, toolMode: 'custom' })).toBe(false);
    expect(
      canReadLocalFileReferences({
        ...base,
        pinnedPluginIds: ['lobe-local-system'],
        toolMode: 'custom',
      }),
    ).toBe(true);
  });

  it('requires local system for builtin agents but not for heterogeneous agents', () => {
    expect(canReadLocalFileReferences({ ...base, isLocalSystemEnabled: false })).toBe(false);
    expect(
      canReadLocalFileReferences({
        ...base,
        isHeterogeneous: true,
        isLocalSystemEnabled: false,
        toolMode: 'chat',
      }),
    ).toBe(true);
  });
});

describe('canRuntimeReachLocalMachine', () => {
  it('uploads instead of referencing a path when a server-run agent has no device gateway', () => {
    expect(canRuntimeReachLocalMachine({ gatewayConnected: false, runtime: 'gateway' })).toBe(
      false,
    );
    expect(canRuntimeReachLocalMachine({ gatewayConnected: true, runtime: 'gateway' })).toBe(true);
  });

  it('lets in-process runs read the path whether or not the gateway is connected', () => {
    expect(canRuntimeReachLocalMachine({ gatewayConnected: false, runtime: 'hetero' })).toBe(true);
    expect(canRuntimeReachLocalMachine({ gatewayConnected: false, runtime: 'client' })).toBe(true);
  });

  it('uploads when the runtime cannot be resolved', () => {
    expect(canRuntimeReachLocalMachine({ gatewayConnected: true, runtime: undefined })).toBe(false);
  });
});
