// Fixture: a local alias of a TRPC procedure is still inference from the router output.
import { lambdaClient } from '@/libs/trpc/client';

export const resolveBySource = async (operationId: string, toolCallId: string) => {
  const mutate = lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate;
  // alint-expect
  let result: Awaited<ReturnType<typeof mutate>>;
  try {
    result = await mutate({ operationId, toolCallId });
  } catch {
    return { resolved: false };
  }
  return { resolved: result.success };
};
