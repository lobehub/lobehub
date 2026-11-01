import debug from 'debug';

const debugLog = debug('lobe-server:agent-runtime:tool-call-stability');

export const logToolCallPc = (
  operationId: string,
  stepIndex: number,
  pc: string,
  getObs: () => Record<string, unknown>,
) => {
  if (!debugLog.enabled) return;

  const formatObservation = (obs: Record<string, unknown>): string => {
    try {
      return `op=${operationId} step=${stepIndex} pc=${pc} obs=${JSON.stringify(obs)}`;
    } catch {
      return `op=${operationId} step=${stepIndex} pc=${pc}`;
    }
  };

  try {
    debugLog('%s', formatObservation(getObs()));
  } catch (error) {
    debugLog('%s', formatObservation({ error: String(error) }));
  }
};
