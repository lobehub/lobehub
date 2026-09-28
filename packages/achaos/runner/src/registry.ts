import type { ChaosAdapter, ChaosOracle } from '@achaos/core';

export class ChaosRegistry {
  readonly #adapters = new Map<string, ChaosAdapter>();
  readonly #oracles = new Map<string, ChaosOracle>();

  registerAdapter(adapter: ChaosAdapter) {
    if (this.#adapters.has(adapter.name))
      throw new Error(`Duplicate chaos adapter: ${adapter.name}`);
    this.#adapters.set(adapter.name, adapter);
    return this;
  }

  registerOracle(oracle: ChaosOracle) {
    if (this.#oracles.has(oracle.name)) throw new Error(`Duplicate chaos oracle: ${oracle.name}`);
    this.#oracles.set(oracle.name, oracle);
    return this;
  }

  resolveAdapter(name: string) {
    const adapter = this.#adapters.get(name);
    if (!adapter) throw new Error(`Unknown chaos adapter: ${name}`);
    return adapter;
  }

  resolveOracle(name: string) {
    const oracle = this.#oracles.get(name);
    if (!oracle) throw new Error(`Unknown chaos oracle: ${name}`);
    return oracle;
  }
}
