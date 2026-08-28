import { type AgentLabelListItem } from '@lobechat/types';

export interface LabelState {
  /**
   * Agent label registry for the current scope (workspace-shared, or
   * personal outside a workspace). Includes archived labels — consumers
   * filter as needed.
   */
  agentLabels: AgentLabelListItem[];
  /**
   * Workspace the loaded registry belongs to (`null` for personal scope).
   * Registries are disjoint per scope, so anything loaded for another
   * workspace must count as not-yet-loaded rather than as stale-but-usable:
   * applying a label id from the wrong scope is a destructive write, not a
   * cosmetic glitch.
   */
  agentLabelsWorkspaceId: string | null;
  /**
   * Whether the label list has been initialized
   */
  isAgentLabelsInit: boolean;
}

export const initialLabelState: LabelState = {
  agentLabels: [],
  agentLabelsWorkspaceId: null,
  isAgentLabelsInit: false,
};
