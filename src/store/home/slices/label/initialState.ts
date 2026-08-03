import { type AgentLabelListItem } from '@lobechat/types';

export interface LabelState {
  /**
   * Agent label registry for the current scope (workspace-shared, or
   * personal outside a workspace). Includes archived labels — consumers
   * filter as needed.
   */
  agentLabels: AgentLabelListItem[];
  /**
   * Whether the label list has been initialized
   */
  isAgentLabelsInit: boolean;
}

export const initialLabelState: LabelState = {
  agentLabels: [],
  isAgentLabelsInit: false,
};
