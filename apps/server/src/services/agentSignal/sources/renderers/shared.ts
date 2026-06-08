import type { EmitSourceEventInput } from '../types';

export const createChainRef = (sourceId: string) => ({
  chainId: `chain:${sourceId}`,
  rootSourceId: sourceId,
});

export const createBaseSource = (input: EmitSourceEventInput) => {
  return {
    chain: createChainRef(input.sourceId),
    payload: input.payload,
    scopeKey: input.scopeKey,
    sourceId: input.sourceId,
    timestamp: input.timestamp,
  };
};
