import { Client } from '@upstash/qstash';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

// NOTICE(@nekomeowww): Scenarios like Vercel Deployment Protection require custom headers on
// intermediate `context.run(...)` calls (which don't accept per-call headers). We inject them via
// a shared QStash client. See:
// https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
export const createWorkflowQstashClient = () =>
  new Client({
    headers: { ...upstashWorkflowExtraHeaders },
    token: process.env.QSTASH_TOKEN!,
  });

export { upstashWorkflowExtraHeaders };
