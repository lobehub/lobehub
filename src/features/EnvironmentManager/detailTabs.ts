/** The detail panel's tabs that describe an environment's copies. */
export type CopyTab = 'instances' | 'overview' | 'sessions';

export const isCopyTab = (tab: string): tab is CopyTab =>
  tab === 'instances' || tab === 'overview' || tab === 'sessions';

/**
 * Which copy tabs the detail panel shows, given how many copies it has.
 *
 * One copy — what nearly every environment has — is not worth a tab of its
 * own: it IS the environment, so its build state, its files and its run
 * history go straight into an Overview. Only once there is a second copy is
 * there a list worth showing, and with it a run history that spans them.
 * An environment with none yet (made before every environment came with one)
 * gets the Overview too, whose empty state offers to make it.
 */
export const copyTabs = (instanceCount: number): CopyTab[] =>
  instanceCount > 1 ? ['instances', 'sessions'] : ['overview'];
