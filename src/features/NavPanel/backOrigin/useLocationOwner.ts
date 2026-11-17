import { MAIN_OWNER } from './locationOwner';

export { MAIN_OWNER, type OpenOwners, parseOpenOwners } from './locationOwner';

/** Which history a location belongs to. The web app has one router. */
export const useLocationOwner = (): string => MAIN_OWNER;

/**
 * The open owners as a stable string key (see `parseOpenOwners`), or `null`
 * when owners never close.
 */
export const useOpenOwnersKey = (): string | null => null;
