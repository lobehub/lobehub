export interface SidebarUIState {
  /**
   * ID of the agent currently being renamed
   */
  agentRenamingId: string | null;
  /**
   * ID of the agent currently being updated
   */
  agentUpdatingId: string | null;
  /**
   * ID of the group currently being renamed
   */
  groupRenamingId: string | null;
  /**
   * ID of the group currently being updated
   */
  groupUpdatingId: string | null;
}

export const initialSidebarUIState: SidebarUIState = {
  agentRenamingId: null,
  agentUpdatingId: null,
  groupRenamingId: null,
  groupUpdatingId: null,
};
