import {
  getToolIdNamespace,
  getToolNameMaxLength,
  setToolIdNamespace,
  setToolNameMaxLength,
} from '@lobechat/context-engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyToolNameMaxLength } from './applyToolNameMaxLength';

let mockStoreState:
  { serverConfig?: { toolIdNamespace?: string; toolNameMaxLength?: number } } | undefined;

vi.mock('@/store/serverConfig', () => ({
  getServerConfigStoreState: () => mockStoreState,
}));

afterEach(() => {
  setToolNameMaxLength(undefined);
  setToolIdNamespace(undefined);
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

  // Regression for the "I am LobeHub" brand leak on the client-driven chat
  // path: without this, a white-label deployment's BUILTIN_TOOL_ID_NAMESPACE
  // would only take effect in gateway (server-run) mode.
  it('applies the server-resolved tool id namespace', () => {
    mockStoreState = { serverConfig: { toolIdNamespace: 'ttw' } };
    applyToolNameMaxLength();
    expect(getToolIdNamespace()).toBe('ttw');
  });

  it('falls back to the canonical namespace when the deployment did not configure it', () => {
    mockStoreState = { serverConfig: {} };
    applyToolNameMaxLength();
    expect(getToolIdNamespace()).toBe('lobe');
  });
});
