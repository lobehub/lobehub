import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('server-services-file-task-admission');

const decisionCounter = meter.createCounter('file_task_admission_decisions_total', {
  description: 'File parse/embedding admission decisions, grouped by decision and task kind.',
  unit: '{decision}',
});

const globalActiveGauge = meter.createGauge('file_task_admission_global_active', {
  description: 'File parse/embedding tasks holding a slot across the deployment.',
  unit: '{task}',
});

export type FileTaskAdmissionDecision =
  /** Took a slot and ran right away. */
  | 'admitted'
  /** Waited in the queue, then took a slot. */
  | 'dequeued'
  /** Delivered while still full, so it went back in the queue. */
  | 'deferred'
  /** Over the limit (or Redis is down), so it went to the queue. */
  | 'queued'
  /** Could not be queued or started; the task was marked failed. */
  | 'rejected';

export interface FileTaskAdmissionMetric {
  decision: FileTaskAdmissionDecision;
  globalActive?: number;
  kind: 'embedding' | 'parse';
}

/** Labels stay low-cardinality: per-workspace detail belongs in the structured log. */
export const recordFileTaskAdmission = ({
  decision,
  globalActive,
  kind,
}: FileTaskAdmissionMetric) => {
  decisionCounter.add(1, { decision, kind });
  if (globalActive !== undefined) globalActiveGauge.record(globalActive);
};
