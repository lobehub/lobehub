import type {
  AgentAccountCapabilities,
  AgentAccountKind,
  AgentAccountProvider,
} from '@lobechat/types';

/**
 * The set of account providers this deployment can issue accounts from.
 *
 * Registration is explicit and provider-name keyed, so a caller can never
 * invent a provider at runtime: `get('agent-mail')` either returns the provider the
 * deployment registered or fails with the list of ones it did. That is the
 * whole point of a registry here — the account row stores a `provider` string,
 * and this is what turns that string back into behaviour.
 */
export class AgentAccountProviderRegistry {
  private readonly providers = new Map<string, AgentAccountProvider>();

  /**
   * Register a provider. Re-registering the same name is a programming error,
   * not a silent override: two implementations for one `provider` value would
   * make the account row ambiguous about which one issued it.
   */
  register(provider: AgentAccountProvider): this {
    if (this.providers.has(provider.provider)) {
      throw new Error(`Agent account provider "${provider.provider}" is already registered`);
    }

    this.providers.set(provider.provider, provider);
    return this;
  }

  has(provider: string): boolean {
    return this.providers.has(provider);
  }

  /** Resolve a provider, with an actionable error when it is not configured. */
  get(provider: string): AgentAccountProvider {
    const resolved = this.providers.get(provider);
    if (!resolved) {
      const known = [...this.providers.keys()];
      throw new Error(
        `Unknown agent account provider "${provider}". ` +
          `Registered providers: ${known.length > 0 ? known.join(', ') : '(none — no identity provider is configured for this deployment)'}`,
      );
    }

    return resolved;
  }

  /** Every registered provider, in registration order. */
  list(): AgentAccountProvider[] {
    return [...this.providers.values()];
  }

  /** Providers that issue a given account kind. */
  listByKind(kind: AgentAccountKind): AgentAccountProvider[] {
    return this.list().filter((provider) => provider.kind === kind);
  }

  /**
   * The capability declaration of a provider. This is what a caller persists
   * onto the account row, so an account never claims capabilities that its
   * provider did not state.
   */
  capabilities(provider: string): AgentAccountCapabilities {
    return this.get(provider).capabilities;
  }
}
