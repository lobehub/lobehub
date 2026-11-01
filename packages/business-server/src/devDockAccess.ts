/**
 * Business extension point for granting production access to DevDock.
 * The default implementation remains closed.
 */
export const getDevDockAccess = async (_userId?: string): Promise<boolean> => false;
