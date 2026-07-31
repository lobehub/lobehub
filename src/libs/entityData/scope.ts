/** Account-wide partition for entity snapshots whose request identity does not vary by workspace. */
export const buildAccountEntityScope = (userId: string): string => `${userId}:account`;
