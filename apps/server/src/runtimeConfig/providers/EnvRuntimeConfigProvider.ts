import type {
  RuntimeConfigDomain,
  RuntimeConfigProvider,
  RuntimeConfigSelector,
  VersionedSnapshot,
} from '../types';

interface EnvRuntimeConfigProviderOptions<T> {
  getSnapshotData: (selector?: RuntimeConfigSelector) => T | null;
}

const ENV_SNAPSHOT_VERSION = 0;
const ENV_SNAPSHOT_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export class EnvRuntimeConfigProvider<T> implements RuntimeConfigProvider<T> {
  constructor(
    public domain: RuntimeConfigDomain<T>,
    private options: EnvRuntimeConfigProviderOptions<T>,
  ) {}

  isEnabled() {
    return true;
  }

  async getSnapshot(selector?: RuntimeConfigSelector): Promise<VersionedSnapshot<T> | null> {
    const data = this.options.getSnapshotData(selector);

    if (!data) return null;

    return {
      data,
      updatedAt: ENV_SNAPSHOT_UPDATED_AT,
      version: ENV_SNAPSHOT_VERSION,
    };
  }
}
