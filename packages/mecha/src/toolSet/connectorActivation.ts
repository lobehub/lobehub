import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { type LobeAgentChatConfig, resolveToolMode } from '@lobechat/types';

/** Agent mode provides the activator by default. Custom toolsets can declare it explicitly. */
export const hasConnectorActivator = (
  chatConfig:
    | Pick<LobeAgentChatConfig, 'enableAgentMode' | 'skillActivateMode' | 'toolMode'>
    | null
    | undefined,
  pluginIds: readonly string[] = [],
  disabledIds: readonly string[] = [],
): boolean => {
  if (disabledIds.includes(LobeActivatorIdentifier)) return false;
  const mode = resolveToolMode(chatConfig);
  return mode === 'agent' || (mode === 'custom' && pluginIds.includes(LobeActivatorIdentifier));
};

export interface ConnectorActivationRequest {
  disabledIds?: Iterable<string>;
  /** Ordinary agent runs can discover connections without a saved switch. */
  discoverByDefault?: boolean;
  /**
   * The run has the activator, so a connector can be found on demand (see
   * {@link hasConnectorActivator}). Without it a connector that is on has no
   * other way to reach the model than joining the invocation set.
   */
  hasActivator: boolean;
  /**
   * Identifiers the agent turned on — every `plugins` entry that is not
   * disabled. Exact toolsets only allow these and turn-scoped additions.
   */
  optedInIds: Iterable<string>;
  /**
   * Identifiers this turn brings in by itself (an @-mention, an internal
   * addition, a share grant that activates a tool). They are reachable and
   * invoked whatever the agent's own switch says.
   */
  turnIds?: Iterable<string>;
}

export interface ConnectorActivation {
  /** Whether the run may reach the connector at all. Off connectors are not. */
  isAllowed: (identifier: string) => boolean;
  /** Whether the connector joins the invocation set without being activated first. */
  isInjected: (identifier: string) => boolean;
}

/**
 * Connectors — MCP connectors, Composio and LobeHub connections, installed
 * plugins — have two states. On means the model finds
 * the connector on demand through the activator; off means the run never sees
 * it. Both runtimes apply this one rule to the connector identifiers they hold;
 * builtin tools and skills keep their own three-state policy.
 */
export const resolveConnectorActivation = (
  request: ConnectorActivationRequest,
): ConnectorActivation => {
  const optedIn = new Set(request.optedInIds);
  const disabled = new Set(request.disabledIds);
  const turn = new Set(request.turnIds ?? []);

  return {
    isAllowed: (identifier) =>
      turn.has(identifier) ||
      (!disabled.has(identifier) && (optedIn.has(identifier) || !!request.discoverByDefault)),
    isInjected: (identifier) =>
      turn.has(identifier) ||
      (!request.hasActivator && !disabled.has(identifier) && optedIn.has(identifier)),
  };
};

/**
 * The invocation candidates once the connector rule is applied: a connector
 * stays only when it is injected, and one that is injected is added even if it
 * was not a candidate. Every other identifier — builtin tools, skills — is
 * left exactly as the caller listed it.
 */
export const applyConnectorActivation = (
  candidateIds: readonly string[],
  connectorIds: Iterable<string>,
  activation: ConnectorActivation,
): string[] => {
  const connectors = new Set(connectorIds);
  const kept = candidateIds.filter(
    (identifier) => !connectors.has(identifier) || activation.isInjected(identifier),
  );
  const injected = [...connectors].filter((identifier) => activation.isInjected(identifier));

  return [...new Set([...kept, ...injected])];
};
