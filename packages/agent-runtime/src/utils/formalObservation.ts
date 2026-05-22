export const formatFormalObservationLog = (
  operationId: string,
  stepIndex: number,
  pc: string,
  obs: Record<string, unknown>,
): string => {
  try {
    return `op=${operationId} step=${stepIndex} pc=${pc} obs=${JSON.stringify(obs)}`;
  } catch {
    return `op=${operationId} step=${stepIndex} pc=${pc}`;
  }
};
