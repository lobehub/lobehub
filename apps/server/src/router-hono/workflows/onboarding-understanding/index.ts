import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import type { WorkflowContext } from '@upstash/workflow';
import { createWorkflow, serveMany } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import { OnboardingTaskRecommendationWorkflow } from '@/server/workflows/onboardingTaskRecommendation';
import {
  OnboardingUnderstandingWorkflow,
  type ProcessCollectedUnderstandingPayload,
  type ProcessUnderstandingProvidersPayload,
} from '@/server/workflows/onboardingUnderstanding';
import {
  processCollectedUnderstanding,
  processCollectedWorkflowOptions,
} from '@/server/workflows/onboardingUnderstanding/processCollected';
import {
  processDetailedPersonaWorkflowOptions,
  processDetailedUnderstandingPersona,
} from '@/server/workflows/onboardingUnderstanding/processDetailedPersona';
import {
  processProvidersWorkflowOptions,
  processUnderstandingProviders,
} from '@/server/workflows/onboardingUnderstanding/processProviders';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

export const processDetailedPersonaWorkflow = createWorkflow<
  ProcessCollectedUnderstandingPayload,
  Awaited<ReturnType<typeof processDetailedUnderstandingPersona>>
>(
  withOtelMetricsForUpstashWorkflows(processDetailedUnderstandingPersona, {
    url: '/api/workflows/onboarding/understanding/process-detailed-persona',
  }),
  processDetailedPersonaWorkflowOptions,
);

export const processCollectedWorkflow = createWorkflow<
  ProcessCollectedUnderstandingPayload,
  Awaited<ReturnType<typeof processCollectedUnderstanding>>
>(
  withOtelMetricsForUpstashWorkflows(
    (context: WorkflowContext<ProcessCollectedUnderstandingPayload>) =>
      processCollectedUnderstanding(context, {
        triggerDetailedPersona: (input, options) =>
          OnboardingUnderstandingWorkflow.triggerDetailedPersona(input, options),
      }),
    { url: '/api/workflows/onboarding/understanding/process-collected' },
  ),
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
        triggerTaskRecommendations: (input, options) =>
          OnboardingTaskRecommendationWorkflow.trigger(input, options),
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
      'process-detailed-persona': processDetailedPersonaWorkflow,
    },
    { qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
