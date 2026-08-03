import type { AgentLabelListItem } from '@lobechat/types';

import { lambdaClient } from '@/libs/trpc/client';

export class AgentLabelService {
  getLabels = (): Promise<AgentLabelListItem[]> => {
    return lambdaClient.agentLabel.getLabels.query();
  };

  createLabel = (params: {
    color?: string;
    description?: string;
    name: string;
  }): Promise<string | undefined> => {
    return lambdaClient.agentLabel.createLabel.mutate(params);
  };

  updateLabel = (
    id: string,
    value: {
      archived?: boolean;
      color?: string | null;
      description?: string | null;
      name?: string;
    },
  ): Promise<void> => {
    return lambdaClient.agentLabel.updateLabel.mutate({ id, value }) as any;
  };

  removeLabel = (id: string): Promise<void> => {
    return lambdaClient.agentLabel.removeLabel.mutate({ id }) as any;
  };

  /**
   * Replace the full label set of an agent. Returns the effective label ids
   * after scope/archive filtering on the server.
   */
  setAgentLabels = (agentId: string, labelIds: string[]): Promise<string[]> => {
    return lambdaClient.agentLabel.setAgentLabels.mutate({ agentId, labelIds });
  };

  /**
   * Apply or remove one label. Use this for toggles — a full replacement built
   * from a cached assignment set drops whatever another editor added since.
   */
  toggleAgentLabel = (agentId: string, labelId: string, assigned: boolean): Promise<string[]> => {
    return lambdaClient.agentLabel.toggleAgentLabel.mutate({ agentId, assigned, labelId });
  };
}

export const agentLabelService = new AgentLabelService();
