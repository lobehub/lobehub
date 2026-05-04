import type {
  AgentSignalSourceEventInput,
  AgentSignalSourceType,
} from '@lobechat/agent-signal/source';

import { lambdaClient } from '@/libs/trpc/client';

type ClientGatewaySourceType = Extract<AgentSignalSourceType, `client.${string}`>;

type ClientGatewaySourceEventInput<TSourceType extends ClientGatewaySourceType> =
  AgentSignalSourceEventInput<TSourceType>;

export interface ListAgentSignalReceiptsParams {
  agentId: string;
  cursor?: number;
  limit?: number;
  topicId: string;
}

class AgentSignalService {
  listReceipts = async (params: ListAgentSignalReceiptsParams) => {
    return lambdaClient.agentSignal.listReceipts.query(params);
  };

  emitSourceEvent = async (payload: ClientGatewaySourceEventInput<ClientGatewaySourceType>) => {
    return lambdaClient.agentSignal.emitSourceEvent.mutate(payload);
  };

  emitClientGatewaySourceEvent = async <TSourceType extends ClientGatewaySourceType>(
    payload: ClientGatewaySourceEventInput<TSourceType>,
  ) => {
    return this.emitSourceEvent({
      ...payload,
      timestamp: payload.timestamp ?? Date.now(),
    });
  };
}

export const agentSignalService = new AgentSignalService();
