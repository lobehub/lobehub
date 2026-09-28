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
