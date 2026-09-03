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
 *
 * A role the primary label already spells out is suppressed for the same
 * reason: a heterogeneous agent defaults to "Max 的 Kimi Code", and tagging it
 * "Kimi Code" again says nothing. Rename it to something that no longer echoes
 * the role and the tag comes back.
 *
 * "Spells out" means the role is the name's whole suffix behind a word
 * boundary — the shape the generated "{owner} 的 {product}" / "{owner}'s
 * {product}" default produces. A name that merely contains the role as a
 * substring ("Arthur" / "Art", "MozArt" / "Art") keeps its tag: that overlap
 * is coincidence, not repetition.
 */
export const agentSecondaryDisplayName = (
  agent: AgentNameFields | null | undefined,
): string | undefined => {
  const role = firstNonBlank(agent?.name) ? firstNonBlank(agent?.title) : undefined;
  if (!role) return undefined;

  const primary = agentDisplayName(agent);
  if (!primary) return role;
  if (primary === role) return undefined;

  if (primary.endsWith(role)) {
    const boundary = primary[primary.length - role.length - 1];
    if (!/[\p{L}\p{N}]/u.test(boundary)) return undefined;
  }

  return role;
};
