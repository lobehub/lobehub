import { USER_HIDDEN_BUILTIN_SKILLS } from '@/helpers/skillFilters';

interface ProfileToolVisibilityOptions {
  agentConnectorIdentifiers?: ReadonlySet<string> | null;
  nonConfigurableBuiltinToolIdentifiers: ReadonlySet<string>;
}

/**
 * Keep the Agent Profile count and selected chips aligned with the tools this
 * surface actually owns. Hidden config entries stay intact because another
 * activation mode or runtime flow may still use them; this surface simply must
 * not represent them as profile-managed Workspace Tools in the current mode.
 */
export const getVisibleProfileToolIds = (
  toolIds: string[],
  {
    agentConnectorIdentifiers,
    nonConfigurableBuiltinToolIdentifiers,
  }: ProfileToolVisibilityOptions,
): string[] =>
  toolIds.filter(
    (toolId) =>
      !USER_HIDDEN_BUILTIN_SKILLS.has(toolId) &&
      !nonConfigurableBuiltinToolIdentifiers.has(toolId) &&
      !agentConnectorIdentifiers?.has(toolId),
  );
