import type { ServerDefaultHeterogeneousModelDescriptor } from '@lobechat/types';

import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingResolution,
} from './types';

/** A file written only inside the managed binding profile or run directory. */
export interface ProviderBindingFilePlan {
  content: string;
  /** Path relative to the host-owned profile or run directory. */
  path: string;
}

/** Inputs for a provider-specific, isolated CLI binding plan. */
export interface PrepareProviderBindingContext {
  args: string[];
  env?: Record<string, string>;
  profileDir: string;
  reference: Extract<HeterogeneousProviderBindingReference, { kind: 'provider' }>;
  resolution: HeterogeneousProviderBindingResolution;
  runDir: string;
}

/** Inputs for a deployment-owned CLI binding plan. */
export interface PrepareServerDefaultBindingContext {
  args: string[];
  endpoint: string;
  env?: Record<string, string>;
  model: string;
  /** The model's card as the deployment describes it; absent when it could not be read. */
  modelDescriptor?: ServerDefaultHeterogeneousModelDescriptor;
  profileDir: string;
}

/** Prepared arguments, environment and managed files for one CLI binding. */
export interface ProviderBindingPlan {
  args: string[];
  /** Release transient resources created while preparing the binding. */
  cleanup?: () => Promise<void>;
  /** Best-effort synchronous release for app shutdown. */
  cleanupSync?: () => void;
  env: Record<string, string>;
  /** Environment variable that receives the per-prompt server operation token. */
  operationTokenEnvKey?: string;
  profileFiles?: ProviderBindingFilePlan[];
  runFiles?: ProviderBindingFilePlan[];
}

/** Optional provider planners accepted by the Node binding host. */
export interface ProviderBindingDriver {
  prepareProviderBinding?: (
    context: PrepareProviderBindingContext,
  ) => Promise<ProviderBindingPlan> | ProviderBindingPlan;
  prepareServerDefaultBinding?: (
    context: PrepareServerDefaultBindingContext,
  ) => Promise<ProviderBindingPlan> | ProviderBindingPlan;
}
