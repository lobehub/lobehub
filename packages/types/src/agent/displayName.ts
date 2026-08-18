/**
 * How an agent is labelled across the product.
 *
 * An agent carries two identity fields: `name` is the personal name it is
 * addressed by ("Alice", "小艾"), `title` is the role it plays ("Health
 * Assistant"). The name wins wherever we show *who* the agent is, and `title`
 * remains the fallback — agents created before names existed have none, and a
 * user is free to clear it.
 *
 * Use this everywhere a name is rendered. Editing surfaces are the exception:
 * a form that writes `title` must bind to the raw `title`, never to the
 * resolved label, or typing into it would start from the wrong value.
 */

export interface AgentNameFields {
  name?: string | null;
  title?: string | null;
}

const firstNonBlank = (...values: (string | null | undefined)[]): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

/**
 * Resolve the label to show for an agent: `name`, else `title`, else the
 * caller's fallback (usually a translated "Custom Agent").
 *
 * Blank-but-present values are treated as absent, so a whitespace-only title
 * saved by an editor can't beat a real name.
 */
export function agentDisplayName(agent: AgentNameFields | null | undefined): string | undefined;
export function agentDisplayName(
  agent: AgentNameFields | null | undefined,
  fallback: string,
): string;
export function agentDisplayName(
  agent: AgentNameFields | null | undefined,
  fallback?: string,
): string | undefined {
  return firstNonBlank(agent?.name, agent?.title, fallback);
}

/**
 * Resolve the supporting label shown beside an agent's primary name: its role.
 *
 * Only an agent with a personal name has one — an agent without a name already
 * renders its title as the primary label, so repeating it would be noise. This
 * is deliberately uniform across every kind of agent, including runtime-backed
 * (heterogeneous) ones: they show their own role rather than their runtime.
 */
export const agentSecondaryDisplayName = (
  agent: AgentNameFields | null | undefined,
): string | undefined => {
  const role = firstNonBlank(agent?.name) ? firstNonBlank(agent?.title) : undefined;

  return role === agentDisplayName(agent) ? undefined : role;
};
