/**
 * The standalone Share router does not own `/agent/*`; a hard replacement is
 * required so the request re-enters the main application instead of hitting
 * the Share router's wildcard exit.
 */
export const navigateFromShareToAgent = (
  agentId: string,
  target: Pick<Location, 'replace'> = window.location,
) => {
  target.replace(`/agent/${agentId}`);
};
