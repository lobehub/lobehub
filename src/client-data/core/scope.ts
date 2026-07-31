/** Account-wide partition for entity snapshots whose request identity does not vary by workspace. */
export const buildAccountClientDataScope = (userId: string): string => `${userId}:account`;
