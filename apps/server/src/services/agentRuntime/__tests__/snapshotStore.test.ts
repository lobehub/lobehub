// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultSnapshotStore, shouldUseAgentS3Tracing } from '../snapshotStore';

const s3Store = { kind: 's3' } as any;
const fileStore = { kind: 'file' } as any;
const createS3 = vi.fn(() => s3Store);
const createFile = vi.fn(() => fileStore);
const factories = { createFile, createS3 };

const setEnv = (nodeEnv: string, agentS3Tracing?: string) => {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('ENABLE_AGENT_S3_TRACING', agentS3Tracing);
};

describe('agent runtime snapshot store defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('enables S3 tracing by default in production when env is unset', () => {
    setEnv('production');

    expect(shouldUseAgentS3Tracing()).toBe(true);
    expect(createDefaultSnapshotStore(factories)).toBe(s3Store);
    expect(createS3).toHaveBeenCalledTimes(1);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('uses the local file snapshot store in development when env is unset', () => {
    setEnv('development');

    expect(shouldUseAgentS3Tracing()).toBe(false);
    expect(createDefaultSnapshotStore(factories)).toBe(fileStore);
    expect(createS3).not.toHaveBeenCalled();
    expect(createFile).toHaveBeenCalledTimes(1);
  });

  it('lets ENABLE_AGENT_S3_TRACING=1 force S3 tracing outside production', () => {
    setEnv('development', '1');

    expect(shouldUseAgentS3Tracing()).toBe(true);
    expect(createDefaultSnapshotStore(factories)).toBe(s3Store);
    expect(createS3).toHaveBeenCalledTimes(1);
    expect(createFile).not.toHaveBeenCalled();
  });

  it('lets an explicit ENABLE_AGENT_S3_TRACING value disable the production default', () => {
    setEnv('production', '0');

    expect(shouldUseAgentS3Tracing()).toBe(false);
    expect(createDefaultSnapshotStore(factories)).toBeNull();
    expect(createS3).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
  });

  it('degrades to null (never throws) when S3 store construction fails', () => {
    setEnv('production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = vi.fn(() => {
      throw new Error('missing S3 creds');
    });

    expect(createDefaultSnapshotStore({ createS3: boom })).toBeNull();
    expect(boom).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('constructs a real store via the default (non-injected) path', () => {
    // Guards the regression: the default path must build a store with NO dynamic
    // require. In dev that is the statically-imported FileSnapshotStore
    // (S3 needs creds, so dev is the safe env to assert a non-null default).
    setEnv('development');

    expect(createDefaultSnapshotStore()).not.toBeNull();
  });
});
