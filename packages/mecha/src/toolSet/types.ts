import type { DeviceExecutionTarget, LobeAgentChatConfig, RuntimeEnvMode } from '@lobechat/types';

/** What the run knows about its device, when a device gateway is involved. */
export interface ToolRuleDeviceFacts {
  /** A device was auto-routed for this run. */
  autoActivated?: boolean;
  /** The run's access policy allows a device at all. */
  canUseDevice: boolean;
  /** The run is committed to one device (routed, or bound but offline). */
  deviceLocked: boolean;
  deviceOnline?: boolean;
  /** Tools the routed device reports supporting (Computer Use opts in). */
  supportedTools?: readonly string[];
}

/** Everything the tool rules read about the run. Assembled by the host. */
export interface ToolRuleRequest {
  agent: {
    chatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'searchMode' | 'toolMode'> | null;
    /** Pinned plugin identifiers (tri-state entries already collapsed). */
    plugins?: readonly string[] | null;
  };
  /**
   * Device facts when the run goes through a device gateway. A host without
   * a gateway (the browser runtime) leaves this out: no device walls apply
   * and the device picker never exists.
   */
  device?: ToolRuleDeviceFacts;
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
