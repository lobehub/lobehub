import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { workflowClient } from '@/libs/qstash';

import {
  type ProcessOnboardingTaskRecommendationPayload,
  ProcessOnboardingTaskRecommendationPayloadSchema,
} from './types';

export type { ProcessOnboardingTaskRecommendationPayload } from './types';

const PROCESS_PATH = '/api/workflows/onboarding/task-recommendations/process';

interface TriggerOptions {
  flowControl?: {
    key: string;
    parallelism: number;
  };
  workflowRunId?: string;
}

/**
 * Triggers the durable onboarding task recommendation workflow at its absolute route.
 *
 * Use when:
 * - An Understanding provider has persisted the first usable connector source
 * - A parent workflow must fan out across a different Hono workflow route
 *
 * Expects:
 * - A validated immutable Understanding source fingerprint
 * - QStash credentials and an internal application URL
 *
 * Returns:
 * - The QStash workflow trigger receipt
 *
 * Call stack:
 *
 * processUnderstandingProviders
 *   -> {@link OnboardingTaskRecommendationWorkflow.trigger}
 *     -> workflowClient.trigger
 *       -> /api/workflows/onboarding/task-recommendations/process
 */
export class OnboardingTaskRecommendationWorkflow {
  /**
   * Triggers one fingerprint-scoped recommendation workflow run.
   *
   * Use when:
   * - The first completed Understanding source schedules recommendation generation
   *
   * Expects:
   * - A payload owned by the authenticated onboarding user
   *
   * Returns:
   * - The QStash trigger receipt for the durable workflow run
   */
  static async trigger(
    input: ProcessOnboardingTaskRecommendationPayload,
    options: TriggerOptions = {},
  ) {
    const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!process.env.QSTASH_TOKEN || !baseUrl) {
      throw new Error('Onboarding task recommendation workflow is unavailable');
    }
    const payload = ProcessOnboardingTaskRecommendationPayloadSchema.parse(input);
    const traceHeaders = new Headers();
    injectActiveTraceHeaders(traceHeaders);
    return workflowClient.trigger({
      body: payload,
      headers: Object.fromEntries(traceHeaders.entries()),
      url: new URL(PROCESS_PATH, baseUrl).toString(),
      ...(options.flowControl ? { flowControl: options.flowControl } : {}),
      ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    });
  }
}
