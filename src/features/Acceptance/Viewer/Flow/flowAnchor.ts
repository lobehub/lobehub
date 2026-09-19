import { createContext } from 'react';

/**
 * Collapsing or expanding a group re-lays out the whole stack around it. The id
 * of the group the user just toggled is handed to the canvas here, so it can
 * bring that group back into view once the new layout lands.
 */
export const FlowAnchorContext = createContext<{ current: string | null }>({ current: null });
