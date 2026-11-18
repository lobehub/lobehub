/** The owner of locations that do not belong to an Electron tab. */
export const MAIN_OWNER = 'main';

/** The owners open in one tab scope (personal or a workspace). */
export interface OpenOwners {
  ids: string[];
  scope: string;
}

export const parseOpenOwners = (key: string | null): OpenOwners | null => {
  if (key === null) return null;
  const [scope, ...ids] = key.split('\n');
  return { ids, scope };
};
