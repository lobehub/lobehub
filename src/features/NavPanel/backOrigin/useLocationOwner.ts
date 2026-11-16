/** The owner of locations that do not belong to an Electron tab. */
export const MAIN_OWNER = 'main';

/** Which history a location belongs to. The web app has one router. */
export const useLocationOwner = (): string => MAIN_OWNER;

/** Owners still open, keyed for `pruneBackOwners`; `null` when owners never close. */
export const useOpenOwnersKey = (): string | null => null;
