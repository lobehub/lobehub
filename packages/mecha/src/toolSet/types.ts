import type { DeviceExecutionTarget, LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';

/**
 * What the run knows about its device through a device gateway. Present only
 * when a gateway exists: without one no device can be dispatched, so the
 * picker never exists regardless of the target.
 */
export interface ToolRuleDeviceFacts {
  /** A device was auto-routed for this run. */
  autoActivated?: boolean;
  deviceOnline?: boolean;
  /** Tools the routed device reports supporting (Computer Use opts in). */
  supportedTools?: readonly string[];
}

/** The run's device policy and plan, independent of whether a gateway exists. */
export interface ToolRuleDeviceAccess {
  /** The run's access policy allows a device at all (external senders do not). */
  canUseDevice: boolean;
  /** The run is committed to one device (routed, or bound but offline). */
  deviceLocked: boolean;
}

/** Everything the tool rules read about the run. Assembled by the host. */
export interface ToolRuleRequest {
  agent: {
    chatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'searchMode' | 'toolMode'> | null;
    /** Pinned plugin identifiers (tri-state entries already collapsed). */
    plugins?: readonly string[] | null;
  };
  /**
   * Gateway device facts. A host without a gateway (the browser runtime, a
   * self-hosted server without one) leaves this out: the device picker never
   * exists and Computer Use is not gated on device support.
   */
  device?: ToolRuleDeviceFacts;
  /**
   * Device policy and plan. A host that resolves an execution plan supplies
   * it so the walls apply even without a gateway; the browser runtime leaves
   * it out and applies no walls.
   */
  deviceAccess?: ToolRuleDeviceAccess;
  /** Plugin identifiers the agent explicitly disabled. */
  disabledPluginIds?: readonly string[];
  /**
   * The host cannot run `local-system` / `auv` for this run regardless of the
   * target (external senders, no local executor).
   */
  disableLocalSystem?: boolean;
  /** The run's effective execution target, resolved by the host. */
  executionTarget: DeviceExecutionTarget;
  hasEnabledKnowledgeBases?: boolean;
  isBotConversation?: boolean;
  /** Verified against the persisted roster, never a client claim. */
  isGroupSupervisor?: boolean;
  /**
   * Local tools can actually run for a `local` target: the routed device is
   * online and auto-activated (gateway), or the host itself is the local
   * machine (desktop client runtime).
   */
  localExecutionReady: boolean;
  /** Memory tool on, as the host resolved it (agent override, else user setting). */
  memoryEnabled?: boolean;
  model: {
    /** The model can call functions; unknown counts as yes. */
    canUseFC: boolean;
    /** The model produces images natively, so the fallback tool is never offered. */
    hasImageOutput?: boolean;
  };
  /**
   * Plugin identifiers the runtime resolved beyond the agent's own (sub-agent,
   * group or page scope); enabled like pinned plugins in agent mode.
   */
  runtimePluginIds?: readonly string[];
  /**
   * The deployment has a constraint-solver service configured. The tool is
   * unusable without one, so a host without it drops the manifest entirely.
   */
  solverServiceEnabled?: boolean;
  /** The application's web-browsing tool should serve search for this model. */
  useApplicationBuiltinSearchTool?: boolean;
}

export type ToolMode = 'agent' | 'chat' | 'custom';

export interface ResolvedToolRules {
  /** Only agent mode lets the activator enable tools beyond the rules. */
  allowExplicitActivation: boolean;
  /** Candidate tools added to the request's own ids before the rules run. */
  defaultToolIds: string[];
  /** Device tools may only exist for device-capable targets. */
  deviceCapable: boolean;
  deviceLocked: boolean;
  /**
   * Identifiers that must not exist in the manifest pool at all, from any
   * source: the agent's disabled plugins plus the device walls.
   */
  excludedIdentifiers: Set<string>;
  /** Per-tool enablement for the enable checker; absent means disabled. */
  rules: Record<string, boolean>;
  runtimeMode: RuntimeEnvMode;
  toolMode: ToolMode;
}
