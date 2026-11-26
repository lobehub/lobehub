import { createContext, useContext } from 'react';

/**
 * Whether a read-only message still takes up the room of the action bar it
 * does not show. Compressed history renders the same messages read-only right
 * after they were live, so keeping the room stops compression from shifting
 * every turn above the divider.
 */
export const KeepActionRowSpaceContext = createContext(false);

export const useKeepActionRowSpace = () => useContext(KeepActionRowSpaceContext);
