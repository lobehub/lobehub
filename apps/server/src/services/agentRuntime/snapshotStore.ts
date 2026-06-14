import type { ISnapshotStore } from '@lobechat/agent-tracing';

const ENABLE_AGENT_S3_TRACING_VALUE = '1';

type SnapshotStoreConstructor = new () => ISnapshotStore;
type SnapshotStoreModuleLoader = (moduleName: string) => unknown;

interface FileSnapshotStoreModule {
  FileSnapshotStore: SnapshotStoreConstructor;
}

interface S3SnapshotStoreModule {
  S3SnapshotStore: SnapshotStoreConstructor;
}

const nodeRequire: SnapshotStoreModuleLoader = (moduleName) => require(moduleName);

export const shouldUseAgentS3Tracing = () => {
  const explicitValue = process.env.ENABLE_AGENT_S3_TRACING;

  if (explicitValue !== undefined) return explicitValue === ENABLE_AGENT_S3_TRACING_VALUE;

  return process.env.NODE_ENV === 'production';
};

/**
 * Create default snapshot store based on environment.
 * - ENABLE_AGENT_S3_TRACING=1 -> S3SnapshotStore
 * - NODE_ENV=production with ENABLE_AGENT_S3_TRACING unset -> S3SnapshotStore
 * - NODE_ENV=development -> FileSnapshotStore
 * - Otherwise -> null (no tracing)
 */
export const createDefaultSnapshotStore = (
  loadModule: SnapshotStoreModuleLoader = nodeRequire,
): ISnapshotStore | null => {
  if (shouldUseAgentS3Tracing()) {
    try {
      const { S3SnapshotStore } = loadModule(
        '@/server/modules/AgentTracing',
      ) as S3SnapshotStoreModule;
      return new S3SnapshotStore();
    } catch {
      // S3SnapshotStore not available
    }
  }

  if (process.env.NODE_ENV === 'development') {
    try {
      const { FileSnapshotStore } = loadModule(
        '@lobechat/agent-tracing',
      ) as FileSnapshotStoreModule;
      return new FileSnapshotStore();
    } catch {
      // agent-tracing not available
    }
  }

  return null;
};
