import { lambdaClient } from '@/libs/trpc/client';
import type {
  AgentSignalSourcePayloadMap,
  AgentSignalSourceType,
} from '@/server/services/agentSignal/sourceTypes';

type ClientGatewaySourceType = Extract<AgentSignalSourceType, `client.${string}`>;

type ClientGatewaySourceEnvelopeInput<TSourceType extends ClientGatewaySourceType> = {
  payload: AgentSignalSourcePayloadMap[TSourceType];
  scopeKey?: string;
  sourceId: string;
  sourceType: TSourceType;
  timestamp?: number;
};

class AgentSignalService {
  emitSourceEvent = async (payload: ClientGatewaySourceEnvelopeInput<ClientGatewaySourceType>) => {
    return lambdaClient.agentSignal.emitSourceEvent.mutate(payload);
  };

  emitClientGatewaySourceEvent = async <TSourceType extends ClientGatewaySourceType>(
    payload: ClientGatewaySourceEnvelopeInput<TSourceType>,
  ) => {
    return this.emitSourceEvent({
      ...payload,
      timestamp: payload.timestamp ?? Date.now(),
    });
  };
}

export const agentSignalService = new AgentSignalService();
