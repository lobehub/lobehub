import { withOtelMetricsForUpstashWorkflows } from '@lobechat/observability-otel/modules/upstash-workflow';
import { serve } from '@upstash/workflow/hono';
import { Hono } from 'hono';

import {
  onboardingUnderstandingWorkflowOptions,
  runOnboardingUnderstandingWorkflow,
} from '@/server/workflows/onboardingUnderstanding/run';
import type { OnboardingUnderstandingWorkflowPayload } from '@/server/workflows/onboardingUnderstanding/types';

import { createWorkflowQstashClient } from '../qstashClient';

const app = new Hono();

app.post(
  '/',
  serve<OnboardingUnderstandingWorkflowPayload>(
    withOtelMetricsForUpstashWorkflows(runOnboardingUnderstandingWorkflow, {
      url: '/api/workflows/onboarding-understanding',
    }),
    { ...onboardingUnderstandingWorkflowOptions, qstashClient: createWorkflowQstashClient() },
  ),
);

export default app;
