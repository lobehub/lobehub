export interface SidebarUIState {
  /**
   * ID of the agent currently being updated
   */
  agentUpdatingId: string | null;
  /**
   * ID of the group currently being updated
   */
  groupUpdatingId: string | null;
}

export const initialSidebarUIState: SidebarUIState = {
  agentUpdatingId: null,
  groupUpdatingId: null,
};
