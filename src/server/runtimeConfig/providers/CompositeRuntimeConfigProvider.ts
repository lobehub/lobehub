import type { RuntimeConfigProvider, RuntimeConfigSelector, VersionedSnapshot } from '../types';

export class CompositeRuntimeConfigProvider<T> implements RuntimeConfigProvider<T> {
  domain: RuntimeConfigProvider<T>['domain'];

  constructor(
    private primary: RuntimeConfigProvider<T>,
    private fallback: RuntimeConfigProvider<T>,
  ) {
    this.domain = primary.domain;
  }

  isEnabled() {
    return this.primary.isEnabled() || this.fallback.isEnabled();
  }

  async getSnapshot(selector?: RuntimeConfigSelector): Promise<VersionedSnapshot<T> | null> {
    if (this.primary.isEnabled()) {
      const snapshot = await this.primary.getSnapshot(selector);
      if (snapshot) return snapshot;
    }

    if (!this.fallback.isEnabled()) return null;

    return this.fallback.getSnapshot(selector);
  }
}
