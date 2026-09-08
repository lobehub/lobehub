/** How a provider prepares or locates the runtime; attached resources are not platform-owned. */
export type EnvironmentRuntime =
  | { image: string; kind: 'container' }
  | { kind: 'virtualMachine'; templateId: string }
  | { kind: 'attached'; resourceId: string };

/** Requested capacity, not a report of resources actually allocated by a provider. */
export interface EnvironmentResourceRequest {
  cpu?: number;
  gpu?: {
    count: number;
    memoryGiB?: number;
    model?: string;
  };
  memoryGiB?: number;
}

/**
 * Persisted registration contract. Provider adapters must validate supported settings
 * before execution. Credentials and live instance state must never be stored here.
 */
export interface EnvironmentConfiguration {
  /** Run when preparing a new runtime, not on every conversation turn. */
  bootstrapCommand?: string;
  /** Omitted means no automatic idle shutdown is requested. */
  idleTimeoutSeconds?: number;
  resources?: EnvironmentResourceRequest;
  runtime: EnvironmentRuntime;
  /** A runtime path, not a repository URL or a persistence guarantee. */
  workingDirectory?: string;
}
