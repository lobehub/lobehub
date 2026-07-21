import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { workflowClient } from '@/libs/qstash';

import {
  type ProcessUnderstandingProvidersPayload,
  ProcessUnderstandingProvidersPayloadSchema,
} from './types';

export type {
  ProcessCollectedUnderstandingPayload,
  ProcessUnderstandingProvidersPayload,
} from './types';

const PROCESS_PROVIDERS_PATH = '/api/workflows/onboarding/understanding/process-providers';

export class UnderstandingWorkflowUnavailableError extends Error {
  readonly code = 'ONBOARDING_UNDERSTANDING_WORKFLOW_UNAVAILABLE';

  constructor() {
    super('Onboarding understanding workflow is unavailable');
    this.name = 'UnderstandingWorkflowUnavailableError';
  }
}

export class OnboardingUnderstandingWorkflow {
  static assertAvailable() {
    const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
    if (!process.env.QSTASH_TOKEN || !baseUrl) {
      throw new UnderstandingWorkflowUnavailableError();
    }
    return baseUrl;
  }

  static async triggerProviders(
    input: ProcessUnderstandingProvidersPayload,
    options?: { workflowRunId?: string },
  ) {
    const baseUrl = this.assertAvailable();
    const parsed = ProcessUnderstandingProvidersPayloadSchema.parse(input);
    const payload = {
      ...parsed,
      providers: parsed.providers.toSorted((left, right) => left.id.localeCompare(right.id)),
    };
    const traceHeaders = new Headers();
    injectActiveTraceHeaders(traceHeaders);

    return workflowClient.trigger({
      body: payload,
      headers: Object.fromEntries(traceHeaders.entries()),
      url: new URL(PROCESS_PROVIDERS_PATH, baseUrl).toString(),
      ...(options?.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    });
  }
}
