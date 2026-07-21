import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import type { WorkflowContext } from '@upstash/workflow';
import { createWorkflow, serveMany } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import {
  type ProcessCollectedUnderstandingPayload,
  type ProcessUnderstandingProvidersPayload,
} from '@/server/workflows/onboardingUnderstanding';
import {
  processCollectedUnderstanding,
  processCollectedWorkflowOptions,
} from '@/server/workflows/onboardingUnderstanding/processCollected';
import {
  processProvidersWorkflowOptions,
  processUnderstandingProviders,
} from '@/server/workflows/onboardingUnderstanding/processProviders';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

export const processCollectedWorkflow = createWorkflow<
  ProcessCollectedUnderstandingPayload,
  Awaited<ReturnType<typeof processCollectedUnderstanding>>
>(
  withOtelMetricsForUpstashWorkflows(processCollectedUnderstanding, {
    url: '/api/workflows/onboarding/understanding/process-collected',
  }),
  processCollectedWorkflowOptions,
);

export const processProvidersWorkflow = createWorkflow<
  ProcessUnderstandingProvidersPayload,
  Awaited<ReturnType<typeof processUnderstandingProviders>>
>(
  withOtelMetricsForUpstashWorkflows(
    (context: WorkflowContext<ProcessUnderstandingProvidersPayload>) =>
      processUnderstandingProviders(context, {
        processCollectedWorkflow,
      }),
    { url: '/api/workflows/onboarding/understanding/process-providers' },
  ),
  processProvidersWorkflowOptions,
);

app.post(
  '/:workflowId',
  serveMany(
    {
      'process-providers': processProvidersWorkflow,
      'process-collected': processCollectedWorkflow,
    },
    { qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
