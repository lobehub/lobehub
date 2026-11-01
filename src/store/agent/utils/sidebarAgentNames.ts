/**
 * Names already shown in the sidebar, so a freshly drawn agent name can skip
 * them — two agents with one name can't be told apart. The profile's dice and
 * "name it for me" button exclude the same list.
 *
 * The home store is loaded lazily: it imports the agent store, so a static
 * import from an agent action would cycle.
 */
export const getSidebarAgentNames = async (): Promise<string[]> => {
  const [{ getHomeStoreState }, { homeAgentListSelectors }] = await Promise.all([
    import('@/store/home'),
    import('@/store/home/selectors'),
  ]);

  return homeAgentListSelectors
    .allAgents(getHomeStoreState())
    .map((agent) => agent.name)
    .filter((name): name is string => !!name);
};
