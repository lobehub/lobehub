// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultSnapshotStore, shouldUseAgentS3Tracing } from '../snapshotStore';

const s3SnapshotStoreMock = vi.fn(() => ({ kind: 's3' }));
const fileSnapshotStoreMock = vi.fn(() => ({ kind: 'file' }));

const setEnv = (nodeEnv: string, agentS3Tracing?: string) => {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('ENABLE_AGENT_S3_TRACING', agentS3Tracing);
};

const loadModule = vi.fn((moduleName: string) => {
  if (moduleName === '@/server/modules/AgentTracing') {
    return { S3SnapshotStore: s3SnapshotStoreMock };
  }

  if (moduleName === '@lobechat/agent-tracing') {
    return { FileSnapshotStore: fileSnapshotStoreMock };
  }

  throw new Error(`Unexpected module: ${moduleName}`);
});

describe('agent runtime snapshot store defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('enables S3 tracing by default in production when env is unset', () => {
    setEnv('production');

    expect(shouldUseAgentS3Tracing()).toBe(true);
    expect(createDefaultSnapshotStore(loadModule)).toEqual({ kind: 's3' });
    expect(loadModule).toHaveBeenCalledWith('@/server/modules/AgentTracing');
    expect(s3SnapshotStoreMock).toHaveBeenCalledTimes(1);
    expect(fileSnapshotStoreMock).not.toHaveBeenCalled();
  });

  it('uses the local file snapshot store in development when env is unset', () => {
    setEnv('development');

    expect(shouldUseAgentS3Tracing()).toBe(false);
    expect(createDefaultSnapshotStore(loadModule)).toEqual({ kind: 'file' });
    expect(loadModule).toHaveBeenCalledWith('@lobechat/agent-tracing');
    expect(s3SnapshotStoreMock).not.toHaveBeenCalled();
    expect(fileSnapshotStoreMock).toHaveBeenCalledTimes(1);
  });

  it('lets ENABLE_AGENT_S3_TRACING=1 force S3 tracing outside production', () => {
    setEnv('development', '1');

    expect(shouldUseAgentS3Tracing()).toBe(true);
    expect(createDefaultSnapshotStore(loadModule)).toEqual({ kind: 's3' });
    expect(loadModule).toHaveBeenCalledWith('@/server/modules/AgentTracing');
    expect(s3SnapshotStoreMock).toHaveBeenCalledTimes(1);
    expect(fileSnapshotStoreMock).not.toHaveBeenCalled();
  });

  it('lets an explicit ENABLE_AGENT_S3_TRACING value disable the production default', () => {
    setEnv('production', '0');

    expect(shouldUseAgentS3Tracing()).toBe(false);
    expect(createDefaultSnapshotStore(loadModule)).toBeNull();
    expect(loadModule).not.toHaveBeenCalled();
    expect(s3SnapshotStoreMock).not.toHaveBeenCalled();
    expect(fileSnapshotStoreMock).not.toHaveBeenCalled();
  });
});
