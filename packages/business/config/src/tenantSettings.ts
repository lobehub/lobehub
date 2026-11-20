/** Feature flag values as stored for a tenant: a switch, or the user ids it is on for. */
export type TenantFeatureFlagValues = Record<string, boolean | string[]>;

/** System model choices of a tenant; every model is served by the `lobehub` provider. */
export interface TenantSystemModels {
  /** Embedding model for knowledge base files. */
  fileEmbedding?: string;
  /** Model that reads images and video for models that cannot. Unset: the capability is off. */
  multimodalUnderstanding?: string;
  /** Model per system agent slot; `default` fills the slots left unset. */
  systemAgent?: Record<string, string>;
}

/** How users of a tenant sign in to the app; written by Admin. */
export interface TenantLoginMethods {
  /** Email and password sign-in and sign-up. */
  emailPassword: boolean;
  /** Passwordless sign-in through an emailed link. */
  magicLink: boolean;
  /** Email sign-ups must verify their address before signing in. */
  requireEmailVerification: boolean;
}

/**
 * Which connectors members may add; written by Admin. Built-in tools are never
 * restricted. The lists hold connector identifiers and apply to connectors from
 * the marketplace (Market MCPs, Composio apps); custom connectors are governed
 * by `allowCustomConnectors` alone, since their identifiers are generated.
 */
export interface TenantConnectorPolicy {
  /** Members may add, edit and authorize their own (custom) connectors. */
  allowCustomConnectors: boolean;
  /** Non-empty: only these marketplace connectors may be added. */
  allowlist: string[];
  /** Marketplace connectors that may never be added; wins over the allowlist. */
  blocklist: string[];
}

export interface TenantSettings {
  /** Absent: no restriction. */
  connectorPolicy?: TenantConnectorPolicy;
  featureFlags: TenantFeatureFlagValues;
  loginMethods: TenantLoginMethods;
  systemModels: TenantSystemModels;
}

/**
 * Settings that vary per tenant in business builds (spec FR-TS-01). Builds
 * without tenant settings return `undefined`, and callers read the deployment
 * environment instead.
 */
export const loadTenantSettings = async (): Promise<TenantSettings | undefined> => undefined;
