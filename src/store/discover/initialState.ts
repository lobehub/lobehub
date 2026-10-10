import type { MCPSliceState } from './slices/mcp/initialState';
import { initialMCPSliceState } from './slices/mcp/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = MCPSliceState;

export const initialState: DiscoverStoreState = {
  ...initialMCPSliceState,
};
