import type { ChaosRunResult, ChaosTimelineEvent } from '@chaos/core';

export interface ChaosTraceSink {
  addEvent: (name: string, attributes: Record<string, boolean | number | string>) => void;
  setAttribute: (name: string, value: boolean | number | string) => void;
}

const eventAttributes = (event: ChaosTimelineEvent) => ({
  'chaos.event.at': event.at,
  'chaos.event.type': event.type,
});

/** Bridges portable chaos results to OpenTelemetry-like spans without depending on an SDK. */
export const recordChaosResult = (sink: ChaosTraceSink, result: ChaosRunResult) => {
  sink.setAttribute('chaos.experiment.id', result.experimentId);
  sink.setAttribute('chaos.run.id', result.runId);
  sink.setAttribute('chaos.seed', result.seed);
  sink.setAttribute('chaos.status', result.status);
  sink.setAttribute('chaos.duration_ms', result.durationMs);
  for (const event of result.timeline) sink.addEvent(`chaos.${event.type}`, eventAttributes(event));
};
