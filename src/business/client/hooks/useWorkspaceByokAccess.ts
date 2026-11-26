/**
 * Whether the active workspace may configure and call providers with its own
 * keys. `undefined` while a business build is still asking the server. Open
 * by default.
 */
export const useWorkspaceByokAccess = (): boolean | undefined => true;
