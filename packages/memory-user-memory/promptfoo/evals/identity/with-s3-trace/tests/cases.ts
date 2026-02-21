import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MemoryExtractionTracePayload } from '@lobechat/types';

type PromptfooAssert =
  | { type: 'javascript'; value: string }
  | { provider?: string; type: 'llm-rubric'; value: string };

interface PromptfooTestCase {
  assert: PromptfooAssert[];
  description: string;
  vars: Record<string, unknown>;
}

const tracesDir = join(dirname(fileURLToPath(import.meta.url)), '../datasets');

const identityShouldDedupe: PromptfooAssert = {
  type: 'javascript',
  value: `
    const jsonOutput = JSON.parse(output);
    return (
      !jsonOutput?.withIdentities?.actions?.add ||
      jsonOutput.withIdentities.actions.add.length === 0
    );
  `,
};

const buildDescription = (tracePath: string, payload: MemoryExtractionTracePayload) => {
  const user = payload.userId || 'unknown-user';
  const source = payload.extractionJob?.source || 'UnknownSource';
  const sourceId = payload.extractionJob?.sourceId || basename(tracePath);

  return `Identity - User ${user} ${source} ${sourceId} should not generate add actions`;
};

// Generate a test case for every trace JSON under datasets/traces.
const testCases: PromptfooTestCase[] = readdirSync(tracesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const tracePath = join(tracesDir, file);
    const tracePayload = JSON.parse(
      readFileSync(tracePath, 'utf8'),
    ) as MemoryExtractionTracePayload;

    return {
      assert: [identityShouldDedupe],
      description: buildDescription(tracePath, tracePayload),
      vars: {
        layer: 'Identity',
        source: tracePayload.extractionJob?.source,
        sourceId: tracePayload.extractionJob?.sourceId,
        tracePath,
        userId: tracePayload.userId,
      },
    };
  });

export default testCases;
