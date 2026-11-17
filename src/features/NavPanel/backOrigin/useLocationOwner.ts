/** The owner of locations that do not belong to an Electron tab. */
export const MAIN_OWNER = 'main';

/** The owners open in one tab scope (personal or a workspace). */
export interface OpenOwners {
  ids: string[];
  scope: string;
}

/** Which history a location belongs to. The web app has one router. */
export const useLocationOwner = (): string => MAIN_OWNER;

/**
 * The open owners as a stable string key (see `parseOpenOwners`), or `null`
 * when owners never close.
 */
export const useOpenOwnersKey = (): string | null => null;

export const parseOpenOwners = (key: string | null): OpenOwners | null => {
  if (key === null) return null;
  const [scope, ...ids] = key.split('\n');
  return { ids, scope };
};
