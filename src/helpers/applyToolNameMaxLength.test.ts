import { getToolNameMaxLength, setToolNameMaxLength } from '@lobechat/context-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyToolNameMaxLength } from './applyToolNameMaxLength';

let mockStoreState: { serverConfig?: { toolNameMaxLength?: number } } | undefined;

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => mockStoreState,
}));

afterEach(() => {
  setToolNameMaxLength(undefined);
  mockStoreState = undefined;
});

describe('applyToolNameMaxLength', () => {
  it('applies the server-resolved value, including 0', () => {
    mockStoreState = { serverConfig: { toolNameMaxLength: 0 } };
    applyToolNameMaxLength();
    expect(getToolNameMaxLength()).toBe(0);

    mockStoreState = { serverConfig: { toolNameMaxLength: 30 } };
    applyToolNameMaxLength();
    expect(getToolNameMaxLength()).toBe(30);
  });

  it('falls back to the default when the deployment did not configure it', () => {
    mockStoreState = { serverConfig: {} };
    applyToolNameMaxLength();
    expect(getToolNameMaxLength()).toBe(64);
  });

  it('leaves an applied value alone while the store does not exist yet', () => {
    mockStoreState = { serverConfig: { toolNameMaxLength: 0 } };
    applyToolNameMaxLength();

    // No store (e.g. called outside the app shell) must not reset to 64.
    mockStoreState = undefined;
    applyToolNameMaxLength();
    expect(getToolNameMaxLength()).toBe(0);
  });
});
