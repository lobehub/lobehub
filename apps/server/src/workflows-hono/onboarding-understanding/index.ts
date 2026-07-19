import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { WorkflowNonRetryableError } from '@upstash/workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import {
  createOnboardingUnderstandingWorkflowOptions,
  runOnboardingUnderstandingWorkflow,
} from '@/server/workflows/onboardingUnderstanding/run';
import {
  type OnboardingUnderstandingWorkflowPayload,
  OnboardingUnderstandingWorkflowPayloadSchema,
} from '@/server/workflows/onboardingUnderstanding/types';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post('/:sessionId', async (context) => {
  const sessionId = decodeURIComponent(context.req.param('sessionId'));
  const handler = serve<OnboardingUnderstandingWorkflowPayload>(
    withOtelMetricsForUpstashWorkflows(
      async (workflowContext) => {
        const parsed = OnboardingUnderstandingWorkflowPayloadSchema.safeParse(
          workflowContext.requestPayload,
        );
        if (!parsed.success || parsed.data.sessionId !== sessionId) {
          throw new WorkflowNonRetryableError(
            'Onboarding understanding workflow session does not match its route',
          );
        }
        return runOnboardingUnderstandingWorkflow(workflowContext);
      },
      {
        url: '/api/workflows/onboarding-understanding/:sessionId',
      },
    ),
    {
      ...createOnboardingUnderstandingWorkflowOptions(sessionId),
      qstashClient: createWorkflowQstashClient(),
    },
  );

  return handler(context);
});

export default app;
