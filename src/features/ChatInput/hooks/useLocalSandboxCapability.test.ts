import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalSandboxCapability } from './useLocalSandboxCapability';

const state = vi.hoisted(() => ({
  isDesktop: true,
  useClientDataSWR: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return state.isDesktop;
  },
}));
vi.mock('@/libs/swr', () => ({ useClientDataSWR: state.useClientDataSWR }));
vi.mock('@/services/electron/localFileService', () => ({ localFileService: {} }));

beforeEach(() => {
  state.isDesktop = true;
  state.useClientDataSWR.mockReset();
});

const keyOfLastCall = () => state.useClientDataSWR.mock.calls.at(-1)![0];

// A null SWR key is what keeps the desktop from probing the host at all.
describe('useLocalSandboxCapability', () => {
  it('probes on desktop by default', () => {
    useLocalSandboxCapability();

    expect(keyOfLastCall()).toEqual(['local-sandbox-capability']);
  });

  it('does not probe when the caller does not offer the option', () => {
    useLocalSandboxCapability(false);

    expect(keyOfLastCall()).toBeNull();
  });

  it('never probes on web', () => {
    state.isDesktop = false;

    useLocalSandboxCapability(true);

    expect(keyOfLastCall()).toBeNull();
  });
});
