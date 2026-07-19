import { randomUUID } from 'node:crypto';

import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { workflowClient } from '@/libs/qstash';

import {
  getOnboardingUnderstandingFlowControlKey,
  type OnboardingUnderstandingWorkflowPayload,
} from './types';

export type { OnboardingUnderstandingWorkflowPayload } from './types';

const WORKFLOW_PATH = '/api/workflows/onboarding-understanding';

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

  static async trigger(
    payload: OnboardingUnderstandingWorkflowPayload,
    options: { workflowRunId?: string } = {},
  ) {
    const baseUrl = this.assertAvailable();

    const traceHeaders = new Headers();
    injectActiveTraceHeaders(traceHeaders);
    const workflowRunId = options.workflowRunId ?? `onboarding-understanding-${randomUUID()}`;

    return workflowClient.trigger({
      body: payload,
      flowControl: {
        key: getOnboardingUnderstandingFlowControlKey(payload.sessionId),
        parallelism: 1,
      },
      headers: Object.fromEntries(traceHeaders.entries()),
      url: new URL(`${WORKFLOW_PATH}/${encodeURIComponent(payload.sessionId)}`, baseUrl).toString(),
      workflowRunId,
    });
  }
}
