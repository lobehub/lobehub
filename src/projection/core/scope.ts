/** Account-wide partition for projections whose request identity does not vary by workspace. */
export const buildAccountProjectionScope = (userId: string): string => `${userId}:account`;
