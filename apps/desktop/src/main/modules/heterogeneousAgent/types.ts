import type {
  HeterogeneousProviderBindingReference,
  HeterogeneousProviderBindingResolution,
} from '@lobechat/heterogeneous-agents';
import type { AgentInputPlan, AgentPromptInput } from '@lobechat/heterogeneous-agents/spawn';

export interface HeterogeneousAgentImageAttachment {
  id: string;
  url: string;
}

export interface HeterogeneousAgentBuildPlan {
  args: string[];
  /**
   * Sensitive positional payload appended to `args` only at the spawn boundary.
   * Keeping it separate prevents generic argv logging and trace metadata from
   * persisting conversation content for CLIs that cannot read prompts on stdin.
   */
  argvPayload?: string;
  stdinPayload?: string;
}

export interface HeterogeneousAgentBuildPlanHelpers {
  buildAgentInput: (agentType: string, input: AgentPromptInput) => Promise<AgentInputPlan>;
}

export interface HeterogeneousAgentBuildPlanParams {
  args: string[];
  helpers: HeterogeneousAgentBuildPlanHelpers;
  /**
   * Optional path to an MCP config JSON written by the controller (e.g. for
   * the local `lobe_cc` AskUserQuestion server). Drivers that recognize the
   * field append `--mcp-config <path>`; others ignore it.
   */
  mcpConfigPath?: string;
  promptInput: AgentPromptInput;
  resumeSessionId?: string;
}

export interface ProviderBindingFilePlan {
  content: string;
  /** Path relative to the host-owned profile or run directory. */
  path: string;
}

export interface PrepareProviderBindingContext {
  args: string[];
  env?: Record<string, string>;
  profileDir: string;
  reference: Extract<HeterogeneousProviderBindingReference, { kind: 'provider' }>;
  resolution: HeterogeneousProviderBindingResolution;
  runDir: string;
}

export interface PrepareServerDefaultBindingContext {
  args: string[];
  endpoint: string;
  env?: Record<string, string>;
  model: string;
  profileDir: string;
}

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

/**
 * Per-agent CLI flag composition + stdin shape. Stream framing is no longer the
 * driver's concern — `AgentStreamPipeline` (`@lobechat/heterogeneous-agents/spawn`)
 * runs JSONL parsing + adapter conversion uniformly for every agent type.
 */
export interface HeterogeneousAgentDriver {
  buildSpawnPlan: (
    params: HeterogeneousAgentBuildPlanParams,
  ) => Promise<HeterogeneousAgentBuildPlan>;
  prepareProviderBinding?: (
    context: PrepareProviderBindingContext,
  ) => Promise<ProviderBindingPlan> | ProviderBindingPlan;
  prepareServerDefaultBinding?: (
    context: PrepareServerDefaultBindingContext,
  ) => Promise<ProviderBindingPlan> | ProviderBindingPlan;
}
