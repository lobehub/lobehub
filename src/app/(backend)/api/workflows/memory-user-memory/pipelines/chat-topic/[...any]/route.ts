import { Client } from '@upstash/qstash';
import { serveMany } from '@upstash/workflow/dist/nextjs';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import { processTopicWorkflow } from '../process-topic/workflows/topic';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const { POST } = serveMany(
  {
    'process-topic': processTopicWorkflow,
  },
  {
    qstashClient: new Client({
      headers: {
        ...upstashWorkflowExtraHeaders,
      },
      token: process.env.QSTASH_TOKEN!,
    }),
  },
);
