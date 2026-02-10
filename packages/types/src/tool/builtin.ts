import { type ReactNode } from 'react';
import { z } from 'zod';

import { type RuntimeStepContext } from '../stepContext';
import { type HumanInterventionConfig, type HumanInterventionPolicy } from './intervention';
import { HumanInterventionConfigSchema, HumanInterventionPolicySchema } from './intervention';

interface Meta {
  /**
   * avatar
   * @desc Avatar of the plugin
   * @nameEN Avatar
   * @descEN Plugin avatar
   */
  avatar?: string;
  /**
   * description
   * @desc Description of the plugin
   * @nameEN Description
   * @descEN Plugin description
   */
  description?: string;
  /**
   * readme
   * @desc Long-form readme content for the plugin
   */
  readme?: string;
  /**
   * tags
   * @desc Tags of the plugin
   * @nameEN Tags
   * @descEN Plugin tags
   */
  tags?: string[];
  title: string;
}

const MetaSchema = z.object({
  avatar: z.string().optional(),
  description: z.string().optional(),
  readme: z.string().optional(),
  tags: z.array(z.string()).optional(),
  title: z.string(),
});

/**
 * Control the render display behavior for tool results
 * - 'collapsed': Default collapsed, user can expand (default)
 * - 'expand': Default expanded, user can collapse
 * - 'alwaysExpand': Always expanded, user cannot collapse
 */
export type RenderDisplayControl = 'alwaysExpand' | 'collapsed' | 'expand';

export const RenderDisplayControlSchema = z.enum(['collapsed', 'expand', 'alwaysExpand']);

/**
 * Dynamic intervention resolver function type
 * Receives tool args and state metadata to determine if condition is met
 * @returns true if intervention is required, false otherwise
 */
export type DynamicInterventionResolver = (
  toolArgs: Record<string, any>,
  metadata?: Record<string, any>,
) => boolean;

/**
 * Global intervention audit configuration
 * Global audits run for EVERY tool call, not just tools with dynamic config.
 * They are evaluated before per-tool dynamic audits in the intervention chain.
 */
export interface GlobalInterventionAuditConfig {
  /**
   * Policy to apply when audit condition is met (returns true)
   * - 'always': cannot be bypassed by auto-run; in headless mode the tool is skipped entirely
   * - 'required': requires intervention but can be bypassed by auto-run
   * @default 'always'
   */
  policy?: HumanInterventionPolicy;

  /**
   * The audit function, reuses DynamicInterventionResolver signature
   */
  resolver: DynamicInterventionResolver;

  /**
   * Unique type identifier for this global audit
   */
  type: string;
}

/**
 * Dynamic intervention configuration
 * Used to dynamically determine intervention policy based on runtime context
 *
 * The resolver is referenced by type identifier and looked up from
 * the dynamicInterventionAudits registry at runtime.
 */
export interface DynamicInterventionConfig {
  /**
   * Default policy when resolver returns false or no resolver is available
   * @default 'never'
   */
  default?: HumanInterventionPolicy;

  /**
   * Policy to apply when resolver condition is met
   * @default 'always'
   */
  policy?: HumanInterventionPolicy;

  /**
   * Resolver type identifier for external resolver lookup
   * The resolver function is registered in dynamicInterventionAudits
   */
  type: string;
}

export const DynamicInterventionConfigSchema = z.object({
  default: HumanInterventionPolicySchema.optional(),
  policy: HumanInterventionPolicySchema.optional(),
  type: z.string(),
});

/**
 * Extended human intervention config that supports dynamic evaluation
 */
export type ExtendedHumanInterventionConfig =
  | HumanInterventionConfig
  | { dynamic: DynamicInterventionConfig };

export const ExtendedHumanInterventionConfigSchema = z.union([
  HumanInterventionConfigSchema,
  z.object({ dynamic: DynamicInterventionConfigSchema }),
]);

export interface LobeChatPluginApi {
  description: string;
  /**
   * Human intervention configuration
   * Controls when and how the tool requires human approval/selection
   *
   * Can be either:
   * - Simple: A policy string ('never', 'always', 'required')
   * - Complex: Array of rules for parameter-level control
   * - Dynamic: { dynamic: DynamicInterventionConfig } for runtime evaluation
   *
   * Examples:
   * - 'always' - always require intervention
   * - [{ match: { command: "git add:*" }, policy: "never" }, { policy: "always" }]
   * - { dynamic: { default: 'never', policy: 'required', type: 'exampleResolver' } } - exampleResolver should register in `GeneralChatAgent.dynamicInterventionAudits`
   *
   */
  humanIntervention?: ExtendedHumanInterventionConfig;
  name: string;
  parameters: Record<string, any>;
  /**
   * Control the render display behavior for tool results
   * - 'collapsed': Default collapsed, user can expand (default)
   * - 'expand': Default expanded, user can collapse
   * - 'alwaysExpand': Always expanded, user cannot collapse
   *
   * @default 'collapsed'
   */
  renderDisplayControl?: RenderDisplayControl;
  url?: string;
}

export const LobeChatPluginApiSchema = z.object({
  description: z.string(),
  humanIntervention: ExtendedHumanInterventionConfigSchema.optional(),
  name: z.string(),
  parameters: z.record(z.string(), z.any()),
  renderDisplayControl: RenderDisplayControlSchema.optional(),
  url: z.string().optional(),
});

export interface BuiltinToolManifest {
  api: LobeChatPluginApi[];

  /**
   * Tool-level default human intervention policy
   * This policy applies to all APIs that don't specify their own policy
   *
   * @default 'never'
   */
  humanIntervention?: HumanInterventionPolicy;

  /**
   * Plugin name
   */
  identifier: string;
  /**
   * metadata
   * @desc Meta data of the plugin
   */
  meta: Meta;
  systemRole: string;
  /**
   * plugin runtime type
   * @default default
   */
  type?: 'builtin';
}

export const BuiltinToolManifestSchema = z.object({
  api: z.array(LobeChatPluginApiSchema),
  humanIntervention: ExtendedHumanInterventionConfigSchema.optional(),
  identifier: z.string(),
  meta: MetaSchema,
  systemRole: z.string(),
  type: z.literal('builtin').optional(),
});

export interface LobeBuiltinTool {
  hidden?: boolean;
  identifier: string;
  manifest: BuiltinToolManifest;
  type: 'builtin';
}

export const LobeBuiltinToolSchema = z.object({
  hidden: z.boolean().optional(),
  identifier: z.string(),
  manifest: BuiltinToolManifestSchema,
  type: z.literal('builtin'),
});

export interface BuiltinRenderProps<Arguments = any, State = any, Content = any> {
  apiName?: string;
  args: Arguments;
  content: Content;
  identifier?: string;
  messageId: string;
  pluginError?: any;
  pluginState?: State;
  /**
   * The tool call ID from the assistant message
   */
  toolCallId?: string;
}

export type BuiltinRender = <A = any, S = any, C = any>(
  props: BuiltinRenderProps<A, S, C>,
) => ReactNode;

export interface BuiltinPortalProps<Arguments = Record<string, any>, State = any> {
  apiName?: string;
  arguments: Arguments;
  identifier: string;
  messageId: string;
  state: State;
}

export type BuiltinPortal = <T = any>(props: BuiltinPortalProps<T>) => ReactNode;

export interface BuiltinPlaceholderProps<T extends Record<string, any> = any> {
  apiName: string;
  args?: T;
  identifier: string;
}

export type BuiltinPlaceholder = (props: BuiltinPlaceholderProps) => ReactNode;

// ==================== Inspector Renderer Types ====================

export interface BuiltinInspectorProps<Arguments = any, State = any> {
  apiName: string;
  args: Arguments;
  identifier: string;
  /**
   * Whether the tool arguments are currently streaming (not yet complete)
   * Use this to distinguish between "arguments streaming" vs "tool executing" states
   */
  isArgumentsStreaming?: boolean;
  isLoading?: boolean;
  partialArgs?: Arguments;
  pluginState?: State;
  result?: { content: string | null; error?: any };
}

export type BuiltinInspector = <A = any, S = any>(props: BuiltinInspectorProps<A, S>) => ReactNode;

// ==================== Streaming Renderer Types ====================

/**
 * Props for streaming render components
 * Note: During streaming phase, only basic info is available.
 * pluginState and streaming content should be fetched from store inside the component.
 */
export interface BuiltinStreamingProps<Arguments = any> {
  apiName: string;
  args: Arguments;
  identifier: string;
  messageId: string;
  toolCallId: string;
}

export type BuiltinStreaming = <A = any>(props: BuiltinStreamingProps<A>) => ReactNode;

export interface BuiltinServerRuntimeOutput {
  content: string;
  error?: any;
  state?: any;
  success: boolean;
}

export interface BuiltinInterventionProps<Arguments = any> {
  apiName?: string;
  args: Arguments;
  identifier?: string;
  messageId: string;
  /**
   * Callback to update the arguments before approval
   * This is called when the user modifies the intervention content
   * The approve action will wait for this async callback to complete
   */
  onArgsChange?: (args: Arguments) => void | Promise<void>;
  /**
   * Register a callback to be called before approval
   * Used by intervention components that need to flush pending saves (e.g., debounced saves)
   * before the approve action proceeds
   * @param id - Unique identifier for the callback (for reliable cleanup)
   * @param callback - The callback to execute before approval
   * @returns Cleanup function to unregister the callback
   */
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
}

export type BuiltinIntervention = (props: BuiltinInterventionProps) => ReactNode;

// ==================== Executor Types ====================

/**
 * Result returned by builtin tool executors
 */
export interface BuiltinToolResult {
  /**
   * The content to display in the tool message
   */
  content?: string;

  /**
   * Error information if the tool execution failed
   */
  error?: {
    body?: any;
    message: string;
    type: string;
  };

  /**
   * Metadata to attach to the tool message
   * Used to mark messages for special handling (e.g., agentCouncil for parallel display)
   */
  metadata?: Record<string, any>;

  /**
   * Plugin state for UI rendering
   */
  state?: any;

  /**
   * Whether to stop the current execution flow
   * - true: Stop execution (e.g., speak/broadcast in group management)
   * - false/undefined: Continue execution
   */
  stop?: boolean;

  /**
   * Whether the tool execution was successful
   */
  success: boolean;
}

/**
 * Context passed to builtin tool executors
 */
export interface BuiltinToolContext {
  /**
   * The current agent ID executing this tool (supervisor agent in group context)
   * Used to identify which agent called the tool for orchestration purposes
   */
  agentId?: string;

  /**
   * The current group ID (only available in group chat context)
   * Used by group management tools to access group member information
   */
  groupId?: string;

  /**
   * Group orchestration callbacks (only available in group chat context)
   * Used by group management tools to trigger the next orchestration phase
   */
  groupOrchestration?: GroupOrchestrationCallbacks;

  /**
   * The tool message ID
   */
  messageId: string;

  /**
   * Optional callback for streaming updates
   * Only needed for tools that support streaming output
   */
  onStreamingUpdate?: (chunk: string) => Promise<void>;

  /**
   * The current operation ID (for abort signal)
   */
  operationId?: string;

  /**
   * Current plugin state for this tool message
   * Use `stepContext` instead for cross-message state
   */
  pluginState?: Record<string, unknown>;

  /**
   * Register a callback to execute after AgentRuntime completes
   * Used for actions that should happen after the current execution flow finishes
   * to avoid race conditions with message updates
   */
  registerAfterCompletion?: (callback: AfterCompletionCallback) => void;

  /**
   * AbortSignal for cancellation detection
   */
  signal?: AbortSignal;

  /**
   * Step context computed at the beginning of each step
   * Contains dynamic state like GTD todos that changes between steps
   * Computed by AgentRuntime and passed to Tool Executors
   */
  stepContext?: RuntimeStepContext;

  /**
   * The current topic ID (only available when operating within a topic)
   * Used by tools that need to create messages or operations within a topic
   */
  topicId?: string | null;

  /**
   * The working directory configured for file operations
   * When set, file operations should be restricted to this directory
   */
  workingDirectory?: string;
}

/**
 * Callback type for after-completion actions
 */
export type AfterCompletionCallback = () => void | Promise<void>;

/**
 * Base params for group orchestration callbacks
 */
export interface GroupOrchestrationBaseParams {
  /**
   * The supervisor agent ID (the one who called this tool)
   */
  supervisorAgentId: string;
}

/**
 * Params for triggerSpeak callback
 */
export interface TriggerSpeakParams extends GroupOrchestrationBaseParams {
  /**
   * The agent ID to speak
   */
  agentId: string;
  /**
   * Optional instruction for the agent
   */
  instruction?: string;
  /**
   * If true, the orchestration will end after this agent responds,
   * without calling the supervisor again.
   */
  skipCallSupervisor?: boolean;
}

/**
 * Params for triggerBroadcast callback
 */
export interface TriggerBroadcastParams extends GroupOrchestrationBaseParams {
  /**
   * Array of agent IDs to broadcast to
   */
  agentIds: string[];
  /**
   * Optional instruction for the agents
   */
  instruction?: string;
  /**
   * If true, the orchestration will end after all agents respond,
   * without calling the supervisor again.
   */
  skipCallSupervisor?: boolean;
  /**
   * The tool message ID that triggered the broadcast
   * Used as parentId for agent responses to build correct message tree
   */
  toolMessageId: string;
}

/**
 * Params for triggerDelegate callback
 */
export interface TriggerDelegateParams extends GroupOrchestrationBaseParams {
  /**
   * The agent ID to delegate to
   */
  agentId: string;
  /**
   * Optional reason for delegation
   */
  reason?: string;
}

/**
 * Params for triggerExecuteTask callback
 */
export interface TriggerExecuteTaskParams extends GroupOrchestrationBaseParams {
  /**
   * The agent ID to execute the task
   */
  agentId: string;
  /**
   * The instruction/task description for the agent
   */
  instruction: string;
  /**
   * Whether to run on the desktop client (for local file/shell access).
   * MUST be true when task requires local-system tools. Default is false (server execution).
   */
  runInClient?: boolean;
  /**
   * If true, the orchestration will end after the task completes,
   * without calling the supervisor again.
   */
  skipCallSupervisor?: boolean;
  /**
   * Optional timeout in milliseconds
   */
  timeout?: number;
  /**
   * The tool message ID that triggered the task
   */
  toolMessageId: string;
}

/**
 * Task item for triggerExecuteTasks callback
 */
export interface TriggerExecuteTaskItem {
  /**
   * The agent ID to execute this task
   */
  agentId: string;
  /**
   * Detailed instruction for the agent to execute
   */
  instruction: string;
  /**
   * Optional timeout in milliseconds for this specific task
   */
  timeout?: number;
  /**
   * Brief title describing what this task does (shown in UI)
   */
  title: string;
}

/**
 * Params for triggerExecuteTasks callback (multiple tasks)
 */
export interface TriggerExecuteTasksParams extends GroupOrchestrationBaseParams {
  /**
   * If true, the orchestration will end after all tasks complete,
   * without calling the supervisor again.
   */
  skipCallSupervisor?: boolean;
  /**
   * Array of tasks to execute, each assigned to a specific agent
   */
  tasks: TriggerExecuteTaskItem[];
  /**
   * The tool message ID that triggered the tasks
   */
  toolMessageId: string;
}

/**
 * Group Orchestration callbacks for group management tools
 * These callbacks are used to trigger the next phase in multi-agent orchestration
 */
export interface GroupOrchestrationCallbacks {
  /**
   * Trigger broadcast to multiple agents
   */
  triggerBroadcast: (params: TriggerBroadcastParams) => Promise<void>;

  /**
   * Trigger delegate to a specific agent
   */
  triggerDelegate: (params: TriggerDelegateParams) => Promise<void>;

  /**
   * Trigger async task execution for an agent
   */
  triggerExecuteTask: (params: TriggerExecuteTaskParams) => Promise<void>;

  /**
   * Trigger async execution of multiple tasks in parallel
   */
  triggerExecuteTasks: (params: TriggerExecuteTasksParams) => Promise<void>;

  /**
   * Trigger speak to a specific agent
   */
  triggerSpeak: (params: TriggerSpeakParams) => Promise<void>;
}

/**
 * Builtin tool executor function type
 */
export type BuiltinToolExecutor<TParams = any> = (
  params: TParams,
  ctx: BuiltinToolContext,
) => Promise<BuiltinToolResult>;

/**
 * Interface for builtin tool executor class
 * Each executor class should implement this interface
 */
export interface IBuiltinToolExecutor {
  /**
   * Get all supported API names
   *
   * @returns Array of supported API names
   */
  getApiNames: () => string[];

  /**
   * Check if this executor supports the given API
   *
   * @param apiName - The API name to check
   * @returns Whether the API is supported
   */
  hasApi: (apiName: string) => boolean;

  /**
   * The tool identifier (e.g., 'lobe-group-management')
   */
  readonly identifier: string;

  /**
   * Invoke a specific API of this tool
   *
   * @param apiName - The API name to invoke
   * @param params - Parameters for the API
   * @param ctx - Execution context
   * @returns The execution result
   */
  invoke: (apiName: string, params: any, ctx: BuiltinToolContext) => Promise<BuiltinToolResult>;
}

/**
 * Base Executor Class
 *
 * Provides automatic invoke/hasApi/getApiNames implementation.
 * Subclasses only need to define business methods.
 *
 * Usage:
 * ```typescript
 * class MyExecutor extends BaseExecutor<typeof MyApiName> {
 *   readonly identifier = 'my-tool';
 *   protected readonly apiEnum = MyApiName;
 *
 *   myMethod = async (params: MyParams, ctx: BuiltinToolContext) => {
 *     // business logic
 *     return { success: true, content: 'result' };
 *   };
 * }
 * ```
 */
export abstract class BaseExecutor<
  TApiEnum extends Record<string, string>,
> implements IBuiltinToolExecutor {
  /**
   * The tool identifier (e.g., 'lobe-group-management')
   */
  abstract readonly identifier: string;

  /**
   * The API name enum for this executor
   * Used to validate API names and auto-discover methods
   */
  protected abstract readonly apiEnum: TApiEnum;

  /**
   * Invoke a specific API of this tool
   * Automatically routes to the corresponding method
   */
  invoke = async (
    apiName: string,
    params: any,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Validate API name
    if (!this.hasApi(apiName)) {
      return {
        error: {
          message: `Unknown API: ${apiName}`,
          type: 'ApiNotFound',
        },
        success: false,
      };
    }

    // Get the method from this instance
    const method = (this as any)[apiName];

    if (typeof method !== 'function') {
      return {
        error: {
          message: `Method not implemented: ${apiName}`,
          type: 'MethodNotImplemented',
        },
        success: false,
      };
    }

    // Invoke the method
    return method(params, ctx);
  };

  /**
   * Check if this executor supports the given API
   */
  hasApi(apiName: string): boolean {
    return Object.values(this.apiEnum).includes(apiName);
  }

  /**
   * Get all supported API names
   */
  getApiNames(): string[] {
    return Object.values(this.apiEnum);
  }
}
