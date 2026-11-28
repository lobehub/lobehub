import type { MockResponder, MockToolCall } from '../mocks/llm';

/**
 * Mocked replies for the streaming render budgets. Each one is fixed text, so
 * every run streams the same bytes in the same number of chunks and the only
 * variable left is the app.
 */

export const STREAMING_WORKLOADS = [
  /** A long plain-Markdown reply streamed in token-sized chunks. */
  'bigstream',
  /** One reply that calls a local tool many times before its final answer. */
  'toolstorm',
  /** A reply dense with headings, tables, lists and highlighted code blocks. */
  'richreply',
] as const;

export type StreamingWorkload = (typeof STREAMING_WORKLOADS)[number];

/** How a workload's reply is cut into SSE chunks. */
export interface StreamPacing {
  /** Characters per `text` event. */
  chunkSize: number;
  /** Milliseconds between two events. */
  delayMs: number;
}

const BIGSTREAM_SECTIONS = 40;

const bigstreamSection = (index: number) => `## Section ${index + 1}

The rollout keeps each shard on its previous version until its health checks
pass for ${index + 3} consecutive minutes. Operators can pause the rollout at any
shard; a paused shard keeps serving traffic and reports its last healthy version.

When a shard fails, the controller rolls it back, waits for the error rate to fall
below the threshold again and only then retries the next batch of ${index + 2} hosts.`;

/** About 16 KB of Markdown prose, ending in a line the test waits for. */
export const BIGSTREAM_REPLY = `${Array.from({ length: BIGSTREAM_SECTIONS }, (_, index) =>
  bigstreamSection(index),
).join('\n\n')}

Bigstream finished after ${BIGSTREAM_SECTIONS} sections.`;

const RICHREPLY_BLOCKS = 12;

const richBlock = (index: number) => `### Change ${index + 1}: cache eviction

| Metric | Before | After |
| ------ | -----: | ----: |
| p50 latency | ${20 + index} ms | ${12 + index} ms |
| Hit rate | ${70 + index}% | ${80 + index}% |
| Memory | ${200 + index * 4} MB | ${150 + index * 3} MB |

- **Eviction** now follows insertion order instead of last access.
- Readers see the newest entry first; see \`pickEntry\` below.
  - Nested detail: entries older than ${index + 5} minutes are skipped.

\`\`\`ts
export const pickEntry = <T>(entries: T[], index: number): T | undefined =>
  entries.at(index % entries.length) ?? entries[0];

export function evict<T>(entries: T[], limit = ${index + 8}): T[] {
  return entries.length > limit ? entries.slice(entries.length - limit) : entries;
}
\`\`\`

\`\`\`python
def evict(entries, limit=${index + 8}):
    return entries[-limit:] if len(entries) > limit else entries
\`\`\`

> Rolled out to ${index + 1} of ${RICHREPLY_BLOCKS} regions. [Runbook](https://lobehub.com/docs)`;

/** About 10 KB of tables, nested lists, quotes and code in two languages. */
export const RICHREPLY_REPLY = `${Array.from({ length: RICHREPLY_BLOCKS }, (_, index) =>
  richBlock(index),
).join('\n\n')}

Richreply finished after ${RICHREPLY_BLOCKS} changes.`;

/** Tool calls the `toolstorm` reply makes, all in one assistant step. */
export const TOOLSTORM_CALLS = 40;

export const TOOLSTORM_FINAL_REPLY = `Toolstorm finished after ${TOOLSTORM_CALLS} calculations.`;

/** The message the test sends for each workload; the mock keys its reply on it. */
export const workloadPrompt = (workload: StreamingWorkload) => `${workload} render budget please`;

/** Text the test waits for: once it is visible, the whole reply has been drawn. */
export const WORKLOAD_FINAL_TEXT: Record<StreamingWorkload, string> = {
  bigstream: `Bigstream finished after ${BIGSTREAM_SECTIONS} sections.`,
  richreply: `Richreply finished after ${RICHREPLY_BLOCKS} changes.`,
  toolstorm: TOOLSTORM_FINAL_REPLY,
};

/**
 * Token-sized chunks at about 1,200 characters a second, a fast model's
 * stream. The mock delivers on a wall-clock schedule, so a busy page receives
 * late chunks together instead of slowing the stream, and every run lasts
 * about as long and produces about as many commits.
 */
const PACING: StreamPacing = { chunkSize: 24, delayMs: 20 };

export const WORKLOAD_PACING: Record<StreamingWorkload, StreamPacing> = {
  bigstream: PACING,
  richreply: PACING,
  toolstorm: PACING,
};

const toolstormCalls = (): MockToolCall[] =>
  Array.from({ length: TOOLSTORM_CALLS }, (_, index) => ({
    arguments: JSON.stringify({ expression: `${index + 1} * ${index + 2}` }),
    id: `call_toolstorm_${index}`,
    // `lobe-calculator` runs in the browser with no approval and no network.
    name: 'lobe-calculator____calculate',
  }));

/**
 * Scripts the mocked LLM for every workload: a text reply, or for `toolstorm`
 * the tool calls first and the final answer once the request carries their
 * results (any `tool` message after the latest user message).
 */
export const streamingResponder: MockResponder = (messages) => {
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user');
  const content = messages[lastUserIndex]?.content;
  // Context processors may wrap the user text, so match the prompt as a fragment.
  const workload =
    typeof content === 'string'
      ? STREAMING_WORKLOADS.find((name) => content.includes(workloadPrompt(name)))
      : undefined;
  if (!workload) return;

  const pacing = WORKLOAD_PACING[workload];

  switch (workload) {
    case 'bigstream': {
      return { ...pacing, text: BIGSTREAM_REPLY };
    }
    case 'richreply': {
      return { ...pacing, text: RICHREPLY_REPLY };
    }
    case 'toolstorm': {
      const hasToolResults = messages.slice(lastUserIndex + 1).some((m) => m.role === 'tool');
      return hasToolResults
        ? { ...pacing, text: TOOLSTORM_FINAL_REPLY }
        : { ...pacing, text: 'Running the calculations now.', toolCalls: toolstormCalls() };
    }
  }
};
