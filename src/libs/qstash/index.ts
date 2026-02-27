import { Client } from '@upstash/qstash';
import { Client as WorkflowClient } from '@upstash/workflow';

const headers = {
  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
    'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  }),
};

/**
 * QStash client with Vercel Deployment Protection bypass headers.
 * Use as `qstashClient` option in Upstash Workflow `serve()`.
 *
 * @see https://upstash.com/docs/workflow/troubleshooting/vercel
 */
export const qstashClient = new Client({
  headers,
  token: process.env.QSTASH_TOKEN!,
});

/**
 * Workflow client with Vercel Deployment Protection bypass headers.
 * Use for triggering workflows via `workflowClient.trigger()`.
 */
export const workflowClient = new WorkflowClient({
  headers,
  token: process.env.QSTASH_TOKEN!,
});
