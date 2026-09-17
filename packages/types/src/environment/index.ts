/** Abstract source material; paths are relative destinations within an instance. */
export type EnvironmentSource =
  | { kind: 'git'; path?: string; ref?: string; url: string }
  | { kind: 'files'; path?: string; uri: string };

export interface EnvironmentResourceRequirements {
  cpu?: number;
  gpu?: { count: number; memoryGiB?: number; model?: string };
  memoryGiB?: number;
}

/** Portable definition, shared by device, sandbox and cluster instances. No credentials. */
export interface EnvironmentConfiguration {
  bootstrapCommand?: string;
  /**
   * Non-secret values exported before anything else runs — a region, a mirror,
   * a feature switch. Credentials are excluded by the same rule that governs
   * the rest of this object: it is stored in plain text and copied into every
   * instance snapshot, so a token written here is a token in the database and
   * in every copy of it. Secrets are resolved by the runtime at use time.
   */
  env?: Record<string, string>;
  /**
   * Whether work in this environment may reach the network. Omitted means the
   * adapter decides, which is not uniform: a sandbox runs connected so that a
   * bootstrap can install anything, while a device simply has whatever network
   * the machine has and cannot enforce a restriction at all.
   */
  internetAccess?: boolean;
  /** Requirements, not a selection of a particular machine or provider. */
  requirements?: EnvironmentResourceRequirements;
  sources?: EnvironmentSource[];
}

/** Remote hosts connected through lh are devices too. Clusters are controlled through rc. */
export type EnvironmentInstanceKind = 'device' | 'sandbox' | 'cluster';

export type EnvironmentInstanceStatus = 'pending' | 'ready' | 'stopped' | 'error';

/** Instance-specific choices. Actual resource observation belongs to the runtime adapter. */
export interface EnvironmentInstanceConfiguration {
  /** Omitted means no automatic idle shutdown is requested. */
  idleTimeoutSeconds?: number;
  image?: string;
  resources?: EnvironmentResourceRequirements;
}
